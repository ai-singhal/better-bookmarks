import { useState, useRef, useEffect } from 'react'
import type { BookmarkWithMetadata } from '../../shared/types'
import { cn, formatRelativeDate, truncateUrl, getFaviconUrl } from '../../shared/utils'
import { FolderPicker } from './FolderPicker'

interface BookmarkTreeNodeProps {
  node: BookmarkWithMetadata
  depth: number
  onRefresh: () => void
}

export function BookmarkTreeNode({
  node,
  depth,
  onRefresh,
}: BookmarkTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1)
  const [showActions, setShowActions] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.title)
  const [showMovePicker, setShowMovePicker] = useState(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const isFolder = !node.url && node.children !== undefined

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isRenaming])

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

  const childCount = isFolder
    ? node.children!.filter((c) => c.url).length
    : 0
  const folderCount = isFolder
    ? node.children!.filter((c) => !c.url && c.children).length
    : 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded-lg group cursor-pointer hover:bg-gray-800/50 transition-colors',
          showActions && 'bg-gray-800/50'
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

      {/* Children */}
      {isFolder && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <BookmarkTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onRefresh={onRefresh}
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
