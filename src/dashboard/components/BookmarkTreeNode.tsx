import { useState, useRef, useEffect } from 'react'
import type { BookmarkInsight, BookmarkWithMetadata } from '../../shared/types'
import { cn, formatRelativeDate, truncateUrl, getFaviconUrl } from '../../shared/utils'
import { FolderPicker } from './FolderPicker'
import { BookmarkInsightEditor } from './BookmarkInsightEditor'

interface BookmarkTreeNodeProps {
  node: BookmarkWithMetadata
  depth: number
  onRefresh: () => void
  onDragStart?: (e: React.DragEvent, node: BookmarkWithMetadata) => void
  onDragOver?: (e: React.DragEvent, node: BookmarkWithMetadata) => void
  onDrop?: (e: React.DragEvent, node: BookmarkWithMetadata) => void
  dragOverId?: string | null
  dragPosition?: 'above' | 'below' | null
}

export function BookmarkTreeNode({
  node,
  depth,
  onRefresh,
  onDragStart,
  onDragOver,
  onDrop,
  dragOverId,
  dragPosition,
}: BookmarkTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1)
  const [showActions, setShowActions] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.title)
  const [showMovePicker, setShowMovePicker] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [insight, setInsight] = useState<BookmarkInsight | undefined>(node.insight)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const isFolder = !node.url && node.children !== undefined

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

  useEffect(() => {
    if (!contextMenu) return

    const handlePointerDown = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    const handleScroll = () => {
      setContextMenu(null)
    }

    const handleOtherMenuOpen = (event: Event) => {
      const customEvent = event as CustomEvent<string>
      if (customEvent.detail !== node.id) {
        setContextMenu(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    document.addEventListener('bookmark-tree-context-menu', handleOtherMenuOpen as EventListener)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('bookmark-tree-context-menu', handleOtherMenuOpen as EventListener)
    }
  }, [contextMenu, node.id])

  const handleDelete = async () => {
    if (!confirm(`Delete "${node.title}"?`)) return
    try {
      if (isFolder) {
        await chrome.bookmarks.removeTree(node.id)
      } else {
        await chrome.bookmarks.remove(node.id)
      }
      onRefresh()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const handleRename = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === node.title) {
      setIsRenaming(false)
      setRenameValue(node.title)
      return
    }
    try {
      await chrome.bookmarks.update(node.id, { title: trimmed })
      setIsRenaming(false)
      onRefresh()
    } catch (err) {
      console.error('Rename failed:', err)
      setRenameValue(node.title)
      setIsRenaming(false)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename()
    } else if (e.key === 'Escape') {
      setIsRenaming(false)
      setRenameValue(node.title)
    }
  }

  const handleMove = async (targetFolderId: string) => {
    try {
      await chrome.bookmarks.move(node.id, { parentId: targetFolderId })
      setShowMovePicker(false)
      onRefresh()
    } catch (err) {
      console.error('Move failed:', err)
    }
  }

  const handleCreateSubfolder = async () => {
    if (!isFolder) return

    const title = window.prompt('Name your new folder', 'New Folder')?.trim()
    if (!title) return

    try {
      await chrome.bookmarks.create({ parentId: node.id, title })
      setExpanded(true)
      onRefresh()
    } catch (err) {
      console.error('Create subfolder failed:', err)
    }
  }

  const childCount = isFolder
    ? node.children!.filter((c) => c.url).length
    : 0
  const folderCount = isFolder
    ? node.children!.filter((c) => !c.url && c.children).length
    : 0
  const bookmarkForEditor =
    insight === undefined
      ? node
      : {
          ...node,
          insight,
        }

  return (
    <div>
      <div
        draggable={!isRenaming}
        onDragStart={(e) => onDragStart?.(e, node)}
        onDragOver={(e) => onDragOver?.(e, node)}
        onDrop={(e) => onDrop?.(e, node)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          document.dispatchEvent(new CustomEvent('bookmark-tree-context-menu', { detail: node.id }))
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded-lg group cursor-pointer hover:bg-gray-800/50 transition-colors',
          (showActions || contextMenu) && 'bg-gray-800/50',
          dragOverId === node.id && dragPosition === 'above' && 'border-t-2 border-t-indigo-500',
          dragOverId === node.id && dragPosition === 'below' && 'border-b-2 border-b-indigo-500'
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
        onClick={() => {
          if (isRenaming) return
          if (isFolder) {
            setExpanded(!expanded)
          } else if (node.url) {
            chrome.tabs.create({ url: node.url })
          }
        }}
      >
        {/* Expand/collapse or favicon */}
        {isFolder ? (
          <svg
            className={cn(
              'w-4 h-4 text-gray-500 transition-transform flex-shrink-0',
              expanded && 'rotate-90'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <img
            src={node.url ? getFaviconUrl(node.url) : ''}
            alt=""
            className="w-4 h-4 rounded flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}

        {/* Folder icon */}
        {isFolder && (
          <svg
            className={cn('w-4 h-4 flex-shrink-0', expanded ? 'text-indigo-400' : 'text-gray-500')}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        )}

        {/* Title — inline rename or display */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-sm bg-gray-800 border border-indigo-500 rounded px-1.5 py-0.5 text-gray-100 outline-none"
          />
        ) : (
          <span
            className={cn(
              'text-sm truncate flex-1',
              isFolder ? 'text-gray-200 font-medium' : 'text-gray-300'
            )}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsRenaming(true)
              setRenameValue(node.title)
            }}
          >
            {node.title || (node.url ? truncateUrl(node.url, 30) : 'Untitled')}
          </span>
        )}

        {/* Metadata */}
        {isFolder && !isRenaming && (
          <span className="text-xs text-gray-600 flex-shrink-0">
            {childCount > 0 && `${childCount}`}
            {folderCount > 0 && childCount > 0 && ' / '}
            {folderCount > 0 && `${folderCount} folders`}
          </span>
        )}

        {!isFolder && !isRenaming && (
          <span className="text-xs text-gray-600 flex-shrink-0 hidden group-hover:inline">
            {formatRelativeDate(node.dateAdded)}
          </span>
        )}

        {/* Action buttons */}
        {showActions && !isRenaming && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Rename */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsRenaming(true)
                setRenameValue(node.title)
              }}
              className="p-1 rounded hover:bg-gray-700/50 text-gray-500 hover:text-gray-300 transition-colors"
              title="Rename"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>

            {/* Move */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMovePicker(true)
              }}
              className="p-1 rounded hover:bg-gray-700/50 text-gray-500 hover:text-gray-300 transition-colors"
              title="Move to folder"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>

            {/* Context / reminder details */}
            {!isFolder && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDetails((current) => !current)
                }}
                className="p-1 rounded hover:bg-gray-700/50 text-gray-500 hover:text-gray-300 transition-colors"
                title="Bookmark context and reminder"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}

            {/* Delete */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDelete()
              }}
              className="p-1 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors"
              title="Delete"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Move Picker Modal */}
      {showMovePicker && (
        <FolderPicker
          currentFolderId={node.parentId}
          excludeId={isFolder ? node.id : undefined}
          onSelect={(folderId) => handleMove(folderId)}
          onClose={() => setShowMovePicker(false)}
        />
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[180px] rounded-xl border border-gray-700 bg-gray-900/95 p-1 shadow-2xl backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!isFolder && (
            <button
              onClick={() => {
                setContextMenu(null)
                if (node.url) {
                  chrome.tabs.create({ url: node.url })
                }
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
            >
              <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7m0 0v7m0-7L10 14" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5v14h14v-5" />
              </svg>
              Open
            </button>
          )}

          {isFolder && (
            <button
              onClick={() => {
                setContextMenu(null)
                setExpanded((current) => !current)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
            >
              <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {expanded ? 'Collapse folder' : 'Expand folder'}
            </button>
          )}

          {isFolder && (
            <button
              onClick={() => {
                setContextMenu(null)
                void handleCreateSubfolder()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
            >
              <svg className="h-4 w-4 text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1h-2V8H4v8h5v2H4a2 2 0 01-2-2V6z" />
                <path d="M14 11V8h2v3h3v2h-3v3h-2v-3h-3v-2h3z" />
              </svg>
              New subfolder
            </button>
          )}

          <button
            onClick={() => {
              setContextMenu(null)
              setIsRenaming(true)
              setRenameValue(node.title)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
          >
            <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Rename
          </button>

          <button
            onClick={() => {
              setContextMenu(null)
              setShowMovePicker(true)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
          >
            <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Move
          </button>

          {!isFolder && (
            <button
              onClick={() => {
                setContextMenu(null)
                setShowDetails((current) => !current)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
            >
              <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}

          <div className="my-1 border-t border-gray-800" />

          <button
            onClick={() => {
              setContextMenu(null)
              void handleDelete()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-red-950/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}

      {!isFolder && showDetails && (
        <div
          className="px-2 pt-1 pb-3"
          style={{ paddingLeft: `${depth * 20 + 32}px` }}
        >
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2">
            <BookmarkInsightEditor
              bookmark={bookmarkForEditor}
              onInsightSaved={(nextInsight) => setInsight(nextInsight)}
            />
          </div>
        </div>
      )}

      {/* Children */}
      {isFolder && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <BookmarkTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onRefresh={onRefresh}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              dragOverId={dragOverId}
              dragPosition={dragPosition}
            />
          ))}
          {node.children.length === 0 && (
            <p
              className="text-xs text-gray-600 py-1"
              style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
            >
              Empty folder
            </p>
          )}
        </div>
      )}
    </div>
  )
}
