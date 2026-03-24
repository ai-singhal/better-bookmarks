import { useCallback, useEffect, useState, useRef } from 'react'
import { useBookmarkStore } from '../../shared/store'
import { getBookmarkTree, countBookmarks } from '../../shared/chromeApi'
import type { BookmarkWithMetadata } from '../../shared/types'
import { BookmarkTreeNode } from '../components/BookmarkTreeNode'

function countFolders(nodes: BookmarkWithMetadata[]): number {
  let count = 0
  for (const node of nodes) {
    if (!node.url && node.children) {
      count++
      count += countFolders(node.children)
    }
  }
  return count
}

function moveNodeWithinParent(
  nodes: BookmarkWithMetadata[],
  movedId: string,
  targetId: string,
  position: 'above' | 'below'
): BookmarkWithMetadata[] {
  let didMove = false

  const nextNodes = nodes.map((node) => {
    if (!node.children) return node

    const movedIndex = node.children.findIndex((child) => child.id === movedId)
    const targetIndex = node.children.findIndex((child) => child.id === targetId)

    if (movedIndex >= 0 && targetIndex >= 0) {
      const children = [...node.children]
      const [movedNode] = children.splice(movedIndex, 1)
      const adjustedTargetIndex = children.findIndex((child) => child.id === targetId)
      const insertIndex = position === 'below' ? adjustedTargetIndex + 1 : adjustedTargetIndex
      children.splice(insertIndex, 0, movedNode)

      didMove = true
      return {
        ...node,
        children: children.map((child, index) => ({
          ...child,
          index,
        })),
      }
    }

    const nextChildren = moveNodeWithinParent(node.children, movedId, targetId, position)
    if (nextChildren !== node.children) {
      didMove = true
      return {
        ...node,
        children: nextChildren,
      }
    }

    return node
  })

  return didMove ? nextNodes : nodes
}

export function BookmarkTree() {
  const bookmarkTree = useBookmarkStore((s) => s.bookmarkTree)
  const setBookmarkTree = useBookmarkStore((s) => s.setBookmarkTree)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ bookmarks: 0, folders: 0 })
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // Drag-and-drop reorder state
  const dragNodeRef = useRef<BookmarkWithMetadata | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'above' | 'below' | null>(null)
  const suppressedMoveIdsRef = useRef<Map<string, number>>(new Map())

  const loadBookmarks = useCallback(async (showSpinner = false) => {
    if (showSpinner) {
      setLoading(true)
    }
    try {
      const tree = await getBookmarkTree()
      setBookmarkTree(tree)
      const bookmarkCount = countBookmarks(tree)
      const folderCount = countFolders(tree)
      setStats({ bookmarks: bookmarkCount, folders: folderCount })
    } catch (err) {
      console.error('Failed to load bookmarks:', err)
    } finally {
      if (showSpinner) {
        setLoading(false)
      }
    }
  }, [setBookmarkTree])

  const handleDragStart = useCallback((e: React.DragEvent, node: BookmarkWithMetadata) => {
    dragNodeRef.current = node
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '0.5'
    requestAnimationFrame(() => { el.style.opacity = '' })
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, targetNode: BookmarkWithMetadata) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragNodeRef.current || dragNodeRef.current.id === targetNode.id) return
    if (dragNodeRef.current.parentId !== targetNode.parentId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    setDragOverId(targetNode.id)
    setDragPosition(e.clientY < midY ? 'above' : 'below')
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: BookmarkWithMetadata) => {
    e.preventDefault()
    const dragNode = dragNodeRef.current
    if (!dragNode || dragNode.id === targetNode.id) return
    if (dragNode.parentId !== targetNode.parentId) return

    const targetIndex = targetNode.index ?? 0
    const newIndex = dragPosition === 'below' ? targetIndex + 1 : targetIndex

    try {
      await chrome.bookmarks.move(dragNode.id, {
        parentId: dragNode.parentId,
        index: newIndex,
      })
      suppressedMoveIdsRef.current.set(dragNode.id, Date.now())
      setBookmarkTree(
        moveNodeWithinParent(bookmarkTree, dragNode.id, targetNode.id, dragPosition === 'below' ? 'below' : 'above')
      )
    } catch (err) {
      console.error('Reorder failed:', err)
    } finally {
      dragNodeRef.current = null
      setDragOverId(null)
      setDragPosition(null)
    }
  }, [bookmarkTree, dragPosition, setBookmarkTree])

  useEffect(() => {
    void loadBookmarks(true)
  }, [loadBookmarks])

  // Listen for bookmark changes
  useEffect(() => {
    const listener = (msg: { type: string; payload?: { id?: string } }) => {
      if (
        msg.type === 'BOOKMARK_CREATED' ||
        msg.type === 'BOOKMARK_REMOVED' ||
        msg.type === 'BOOKMARK_CHANGED' ||
        msg.type === 'BOOKMARK_MOVED'
      ) {
        if (msg.type === 'BOOKMARK_MOVED' && msg.payload?.id) {
          const suppressedAt = suppressedMoveIdsRef.current.get(msg.payload.id)
          if (suppressedAt && Date.now() - suppressedAt < 1500) {
            suppressedMoveIdsRef.current.delete(msg.payload.id)
            return
          }
        }

        void loadBookmarks(false)
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [loadBookmarks])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading bookmarks...</p>
        </div>
      </div>
    )
  }

  // The root nodes are inside tree[0].children (Bookmarks Bar, Other Bookmarks, Mobile Bookmarks)
  const rootChildren = bookmarkTree[0]?.children || []

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Bookmarks</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {stats.bookmarks} bookmarks in {stats.folders} folders
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCreatingFolder(true)}
              className="px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
            >
              + New Folder
            </button>
            <button
              onClick={() => void loadBookmarks(true)}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* New folder inline input */}
      {creatingFolder && (
        <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && newFolderName.trim()) {
                // Create in "Other Bookmarks" (id "2") by default
                await chrome.bookmarks.create({ parentId: '1', title: newFolderName.trim() })
                setCreatingFolder(false)
                setNewFolderName('')
                loadBookmarks(false)
              } else if (e.key === 'Escape') {
                setCreatingFolder(false)
                setNewFolderName('')
              }
            }}
            onBlur={() => { setCreatingFolder(false); setNewFolderName('') }}
            autoFocus
            placeholder="Folder name..."
            className="flex-1 text-sm bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-gray-100 outline-none placeholder:text-gray-500"
          />
          <span className="text-xs text-gray-500">Enter to create, Esc to cancel</span>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {rootChildren.map((node) => (
          <BookmarkTreeNode
            key={node.id}
            node={node}
            depth={0}
            onRefresh={loadBookmarks}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragOverId={dragOverId}
            dragPosition={dragPosition}
          />
        ))}
      </div>
    </div>
  )
}
