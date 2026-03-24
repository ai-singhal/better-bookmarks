interface DeletedBookmarkNodeSnapshot {
  title: string
  url?: string
  parentId?: string
  index?: number
  children?: DeletedBookmarkNodeSnapshot[]
}

export interface DeletedBookmarkRecord {
  id: string
  deletedAt: number
  title: string
  url?: string
  parentId?: string
  index?: number
  pathHint?: string
  node: DeletedBookmarkNodeSnapshot
}

const DELETED_BOOKMARKS_STORAGE_KEY = 'deleted_bookmarks_v1'
const MAX_DELETED_BOOKMARKS = 50

function snapshotBookmarkNode(node: chrome.bookmarks.BookmarkTreeNode): DeletedBookmarkNodeSnapshot {
  return {
    title: node.title,
    url: node.url,
    parentId: node.parentId,
    index: node.index,
    children: node.children?.map(snapshotBookmarkNode),
  }
}

function isFolderSnapshot(node: DeletedBookmarkNodeSnapshot): boolean {
  return !node.url && Array.isArray(node.children)
}

async function getStorageRecords(): Promise<DeletedBookmarkRecord[]> {
  const data = await chrome.storage.local.get(DELETED_BOOKMARKS_STORAGE_KEY)
  return (data[DELETED_BOOKMARKS_STORAGE_KEY] as DeletedBookmarkRecord[]) || []
}

async function setStorageRecords(records: DeletedBookmarkRecord[]): Promise<void> {
  await chrome.storage.local.set({
    [DELETED_BOOKMARKS_STORAGE_KEY]: records,
  })
}

export async function getDeletedBookmarks(): Promise<DeletedBookmarkRecord[]> {
  return getStorageRecords()
}

export async function recordDeletedBookmark(
  id: string,
  node: chrome.bookmarks.BookmarkTreeNode
): Promise<void> {
  const records = await getStorageRecords()

  const nextRecord: DeletedBookmarkRecord = {
    id: `${id}-${Date.now()}`,
    deletedAt: Date.now(),
    title: node.title || (node.url ? node.url : 'Untitled'),
    url: node.url,
    parentId: node.parentId,
    index: node.index,
    pathHint: node.parentId,
    node: snapshotBookmarkNode(node),
  }

  const nextRecords = [nextRecord, ...records].slice(0, MAX_DELETED_BOOKMARKS)
  await setStorageRecords(nextRecords)
}

export async function removeDeletedBookmark(recordId: string): Promise<void> {
  const records = await getStorageRecords()
  await setStorageRecords(records.filter((record) => record.id !== recordId))
}

async function resolveParentId(parentId?: string): Promise<string> {
  if (parentId) {
    try {
      await chrome.bookmarks.get(parentId)
      return parentId
    } catch {
      // Fall back below.
    }
  }

  return '1'
}

async function restoreNode(
  snapshot: DeletedBookmarkNodeSnapshot,
  fallbackParentId?: string
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const parentId = await resolveParentId(snapshot.parentId || fallbackParentId)
  const base = {
    parentId,
    index: snapshot.index,
    title: snapshot.title,
  }

  if (isFolderSnapshot(snapshot)) {
    const folder = await chrome.bookmarks.create(base)

    for (const child of snapshot.children || []) {
      await restoreNode(child, folder.id)
    }

    return folder
  }

  return chrome.bookmarks.create({
    ...base,
    url: snapshot.url,
  })
}

export async function restoreDeletedBookmark(recordId: string): Promise<void> {
  const records = await getStorageRecords()
  const record = records.find((item) => item.id === recordId)
  if (!record) return

  await restoreNode(record.node, record.parentId)
  await setStorageRecords(records.filter((item) => item.id !== recordId))
}
