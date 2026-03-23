import type { BookmarkWithMetadata } from './types'
import { attachInsightsToBookmarks } from '../lib/bookmarkInsightService'

function chromeTreeToBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkWithMetadata[] {
  return nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    url: node.url,
    dateAdded: node.dateAdded,
    dateGroupModified: node.dateGroupModified,
    index: node.index,
    children: node.children
      ? chromeTreeToBookmarks(node.children)
      : undefined,
  }))
}

export async function getBookmarkTree(): Promise<BookmarkWithMetadata[]> {
  const tree = await chrome.bookmarks.getTree()
  return attachInsightsToBookmarks(chromeTreeToBookmarks(tree))
}

export async function searchBookmarks(
  query: string
): Promise<BookmarkWithMetadata[]> {
  const results = await chrome.bookmarks.search(query)
  return attachInsightsToBookmarks(results.map((node) => ({
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    url: node.url,
    dateAdded: node.dateAdded,
    index: node.index,
  })))
}

export async function moveBookmark(
  id: string,
  destination: { parentId?: string; index?: number }
): Promise<BookmarkWithMetadata> {
  const result = await chrome.bookmarks.move(id, destination)
  return {
    id: result.id,
    parentId: result.parentId,
    title: result.title,
    url: result.url,
    index: result.index,
  }
}

export async function removeBookmark(id: string): Promise<void> {
  await chrome.bookmarks.remove(id)
}

export async function removeBookmarkTree(id: string): Promise<void> {
  await chrome.bookmarks.removeTree(id)
}

export async function createBookmark(bookmark: {
  parentId?: string
  title: string
  url?: string
  index?: number
}): Promise<BookmarkWithMetadata> {
  const result = await chrome.bookmarks.create(bookmark)
  return {
    id: result.id,
    parentId: result.parentId,
    title: result.title,
    url: result.url,
    index: result.index,
  }
}

export async function updateBookmark(
  id: string,
  changes: { title?: string; url?: string }
): Promise<BookmarkWithMetadata> {
  const result = await chrome.bookmarks.update(id, changes)
  return {
    id: result.id,
    parentId: result.parentId,
    title: result.title,
    url: result.url,
    index: result.index,
  }
}

export function getBookmarkFolderPath(
  tree: BookmarkWithMetadata[],
  targetId: string
): string {
  const path: string[] = []

  function find(nodes: BookmarkWithMetadata[], currentPath: string[]): boolean {
    for (const node of nodes) {
      if (node.id === targetId) {
        path.push(...currentPath, node.title)
        return true
      }
      if (node.children) {
        if (find(node.children, [...currentPath, node.title])) {
          return true
        }
      }
    }
    return false
  }

  find(tree, [])
  return path.join(' / ')
}

export async function getParentFolderName(parentId?: string): Promise<string> {
  if (!parentId) return ''
  try {
    const [parent] = await chrome.bookmarks.get(parentId)
    return parent.title || 'Bookmarks'
  } catch {
    return ''
  }
}

export async function resolveBookmarkFolders(
  bookmarks: BookmarkWithMetadata[]
): Promise<Map<string, string>> {
  const folderMap = new Map<string, string>()
  const parentIds = new Set(
    bookmarks.map((b) => b.parentId).filter((id): id is string => !!id)
  )

  await Promise.all(
    [...parentIds].map(async (parentId) => {
      const name = await getParentFolderName(parentId)
      folderMap.set(parentId, name)
    })
  )

  return folderMap
}

export function countBookmarks(nodes: BookmarkWithMetadata[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.url) count++
    if (node.children) count += countBookmarks(node.children)
  }
  return count
}

export function flattenBookmarks(
  nodes: BookmarkWithMetadata[]
): BookmarkWithMetadata[] {
  const result: BookmarkWithMetadata[] = []
  for (const node of nodes) {
    if (node.url) result.push(node)
    if (node.children) result.push(...flattenBookmarks(node.children))
  }
  return result
}
