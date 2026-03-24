import type {
  BookmarkSnapshotNode,
  BookmarkTreeSnapshot,
  BookmarkTreeSnapshotRoot,
  BookmarkTreeSnapshotSummary,
} from '../shared/types'

interface StoredSnapshotManifestEntry extends BookmarkTreeSnapshotSummary {
  chunkCount: number
}

const SNAPSHOT_MANIFEST_KEY = 'bookmark_tree_snapshots_manifest_v1'
const SNAPSHOT_CHUNK_PREFIX = 'bookmark_tree_snapshot_chunk_v1_'
export const BOOKMARK_RESTORE_IN_PROGRESS_KEY = 'bookmark_restore_in_progress_v1'
const MAX_SNAPSHOTS = 3
const CHUNK_SIZE = 3000

export interface LatestSnapshotComparison {
  latestSnapshot: BookmarkTreeSnapshotSummary | null
  matchesCurrentTree: boolean | null
}

function normalizeRootKey(node: chrome.bookmarks.BookmarkTreeNode): string {
  return node.title.trim().toLowerCase().replace(/\s+/g, '_')
}

function snapshotNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkSnapshotNode {
  return {
    title: node.title,
    url: node.url,
    children: node.children?.map(snapshotNode),
  }
}

function countSnapshotNodes(nodes: BookmarkSnapshotNode[]): { bookmarks: number; folders: number } {
  let bookmarks = 0
  let folders = 0

  for (const node of nodes) {
    if (node.url) {
      bookmarks += 1
      continue
    }

    folders += 1
    if (node.children?.length) {
      const childCounts = countSnapshotNodes(node.children)
      bookmarks += childCounts.bookmarks
      folders += childCounts.folders
    }
  }

  return { bookmarks, folders }
}

function splitIntoChunks(value: string): string[] {
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

function getChunkKeys(snapshotId: string, chunkCount: number): string[] {
  return Array.from({ length: chunkCount }, (_, index) => `${SNAPSHOT_CHUNK_PREFIX}${snapshotId}_${index}`)
}

async function getManifest(): Promise<StoredSnapshotManifestEntry[]> {
  const data = await chrome.storage.sync.get(SNAPSHOT_MANIFEST_KEY)
  return (data[SNAPSHOT_MANIFEST_KEY] as StoredSnapshotManifestEntry[]) || []
}

async function setManifest(entries: StoredSnapshotManifestEntry[]): Promise<void> {
  await chrome.storage.sync.set({
    [SNAPSHOT_MANIFEST_KEY]: entries.sort((a, b) => b.createdAt - a.createdAt),
  })
}

async function pruneSnapshots(entries: StoredSnapshotManifestEntry[]): Promise<StoredSnapshotManifestEntry[]> {
  if (entries.length <= MAX_SNAPSHOTS) return entries

  const toRemove = [...entries].sort((a, b) => a.createdAt - b.createdAt).slice(0, entries.length - MAX_SNAPSHOTS)
  const keysToRemove = toRemove.flatMap((entry) => getChunkKeys(entry.id, entry.chunkCount))
  if (keysToRemove.length > 0) {
    await chrome.storage.sync.remove(keysToRemove)
  }

  const removedIds = new Set(toRemove.map((entry) => entry.id))
  return entries.filter((entry) => !removedIds.has(entry.id))
}

async function loadSnapshotPayload(snapshotId: string): Promise<BookmarkTreeSnapshot | null> {
  const manifest = await getManifest()
  const entry = manifest.find((item) => item.id === snapshotId)
  if (!entry) return null

  const chunkKeys = getChunkKeys(snapshotId, entry.chunkCount)
  const storedChunks = await chrome.storage.sync.get(chunkKeys)
  const serialized = chunkKeys.map((key) => String(storedChunks[key] || '')).join('')
  if (!serialized) return null

  return JSON.parse(serialized) as BookmarkTreeSnapshot
}

async function createNodeFromSnapshot(
  node: BookmarkSnapshotNode,
  parentId: string,
  index: number
): Promise<void> {
  if (node.url) {
    await chrome.bookmarks.create({
      parentId,
      index,
      title: node.title,
      url: node.url,
    })
    return
  }

  const folder = await chrome.bookmarks.create({
    parentId,
    index,
    title: node.title,
  })

  for (const [childIndex, child] of (node.children || []).entries()) {
    await createNodeFromSnapshot(child, folder.id, childIndex)
  }
}

async function clearRootChildren(rootId: string): Promise<void> {
  const children = await chrome.bookmarks.getChildren(rootId)
  for (const child of [...children].sort((a, b) => (b.index ?? 0) - (a.index ?? 0))) {
    if (child.children) {
      await chrome.bookmarks.removeTree(child.id)
    } else {
      await chrome.bookmarks.remove(child.id)
    }
  }
}

function buildSnapshotRoots(tree: chrome.bookmarks.BookmarkTreeNode[]): BookmarkTreeSnapshotRoot[] {
  const rootChildren = tree[0]?.children || []
  return rootChildren.map((rootNode) => ({
    rootKey: normalizeRootKey(rootNode),
    title: rootNode.title,
    children: (rootNode.children || []).map(snapshotNode),
  }))
}

export async function listBookmarkTreeSnapshots(): Promise<BookmarkTreeSnapshotSummary[]> {
  const manifest = await getManifest()
  return manifest
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ chunkCount: _chunkCount, ...summary }) => summary)
}

export async function compareCurrentTreeWithLatestSnapshot(): Promise<LatestSnapshotComparison> {
  const latestSnapshot = (await listBookmarkTreeSnapshots())[0] || null
  if (!latestSnapshot) {
    return { latestSnapshot: null, matchesCurrentTree: null }
  }

  const snapshot = await loadSnapshotPayload(latestSnapshot.id)
  if (!snapshot) {
    return { latestSnapshot, matchesCurrentTree: null }
  }

  const currentTree = await chrome.bookmarks.getTree()
  const currentRoots = buildSnapshotRoots(currentTree)

  return {
    latestSnapshot,
    matchesCurrentTree: JSON.stringify(currentRoots) === JSON.stringify(snapshot.roots),
  }
}

export async function createBookmarkTreeSnapshot(label?: string): Promise<BookmarkTreeSnapshotSummary> {
  const tree = await chrome.bookmarks.getTree()
  const roots = buildSnapshotRoots(tree)
  const counts = roots.reduce(
    (totals, root) => {
      const childCounts = countSnapshotNodes(root.children)
      return {
        bookmarks: totals.bookmarks + childCounts.bookmarks,
        folders: totals.folders + childCounts.folders,
      }
    },
    { bookmarks: 0, folders: 0 }
  )

  const snapshot: BookmarkTreeSnapshot = {
    version: 1,
    roots,
  }

  const snapshotId = `snapshot_${Date.now()}`
  const serialized = JSON.stringify(snapshot)
  const chunks = splitIntoChunks(serialized)
  const chunkEntries = Object.fromEntries(
    chunks.map((chunk, index) => [`${SNAPSHOT_CHUNK_PREFIX}${snapshotId}_${index}`, chunk])
  )

  const summary: StoredSnapshotManifestEntry = {
    id: snapshotId,
    label: label?.trim() || new Date().toLocaleString(),
    createdAt: Date.now(),
    bookmarkCount: counts.bookmarks,
    folderCount: counts.folders,
    rootCount: roots.length,
    chunkCount: chunks.length,
  }

  const manifest = await pruneSnapshots([summary, ...(await getManifest())])

  try {
    await chrome.storage.sync.set(chunkEntries)
    await setManifest(manifest)
  } catch (err) {
    await chrome.storage.sync.remove(getChunkKeys(snapshotId, chunks.length))
    throw err
  }

  const { chunkCount: _chunkCount, ...publicSummary } = summary
  return publicSummary
}

export async function deleteBookmarkTreeSnapshot(snapshotId: string): Promise<void> {
  const manifest = await getManifest()
  const entry = manifest.find((item) => item.id === snapshotId)
  if (!entry) return

  await chrome.storage.sync.remove(getChunkKeys(snapshotId, entry.chunkCount))
  await setManifest(manifest.filter((item) => item.id !== snapshotId))
}

export async function restoreBookmarkTreeSnapshot(snapshotId: string): Promise<void> {
  const snapshot = await loadSnapshotPayload(snapshotId)
  if (!snapshot) {
    throw new Error('Snapshot not found.')
  }

  await chrome.storage.local.set({ [BOOKMARK_RESTORE_IN_PROGRESS_KEY]: true })

  try {
    const currentTree = await chrome.bookmarks.getTree()
    const rootChildren = currentTree[0]?.children || []

    for (const snapshotRoot of snapshot.roots) {
      const targetRoot = rootChildren.find((rootNode) =>
        normalizeRootKey(rootNode) === snapshotRoot.rootKey || rootNode.title === snapshotRoot.title
      )
      if (!targetRoot) continue

      await clearRootChildren(targetRoot.id)

      for (const [index, child] of snapshotRoot.children.entries()) {
        await createNodeFromSnapshot(child, targetRoot.id, index)
      }
    }
  } finally {
    await chrome.storage.local.remove(BOOKMARK_RESTORE_IN_PROGRESS_KEY)
  }
}
