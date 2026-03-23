import { useState, useEffect } from 'react'
import type { BookmarkWithMetadata } from '../../shared/types'
import { getBookmarkTree } from '../../shared/chromeApi'
import { cn } from '../../shared/utils'

interface FolderPickerProps {
  currentFolderId?: string
  excludeId?: string
  onSelect: (folderId: string, folderTitle: string) => void
  onClose: () => void
}

export function FolderPicker({ currentFolderId, excludeId, onSelect, onClose }: FolderPickerProps) {
  const [tree, setTree] = useState<BookmarkWithMetadata[]>([])

  useEffect(() => {
    getBookmarkTree().then(setTree)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-[400px] max-h-[500px] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Move to folder</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {(tree[0]?.children || []).map((node) => (
            <FolderPickerNode
              key={node.id}
              node={node}
              depth={0}
              currentFolderId={currentFolderId}
              excludeId={excludeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function FolderPickerNode({
  node,
  depth,
  currentFolderId,
  excludeId,
  onSelect,
}: {
  node: BookmarkWithMetadata
  depth: number
  currentFolderId?: string
  excludeId?: string
  onSelect: (folderId: string, folderTitle: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isFolder = !node.url && node.children !== undefined
  const isCurrent = node.id === currentFolderId
  const isExcluded = node.id === excludeId

  if (!isFolder || isExcluded) return null

  const subFolders = node.children?.filter((c) => !c.url && c.children) || []

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
          isCurrent
            ? 'bg-indigo-600/10 text-indigo-400'
            : 'hover:bg-gray-800/60 text-gray-300'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {subFolders.length > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            className="p-0.5"
          >
            <svg
              className={cn('w-3 h-3 text-gray-500 transition-transform', expanded && 'rotate-90')}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-4" />
        )}

        <svg
          className={cn('w-4 h-4 flex-shrink-0', isCurrent ? 'text-indigo-400' : 'text-gray-500')}
          fill="currentColor" viewBox="0 0 20 20"
        >
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>

        <button
          onClick={() => onSelect(node.id, node.title)}
          className="text-sm truncate flex-1 text-left hover:text-white transition-colors"
        >
          {node.title || 'Untitled'}
        </button>

        {isCurrent && (
          <span className="text-[10px] text-indigo-400/60 flex-shrink-0">current</span>
        )}
      </div>

      {expanded && subFolders.map((child) => (
        <FolderPickerNode
          key={child.id}
          node={child}
          depth={depth + 1}
          currentFolderId={currentFolderId}
          excludeId={excludeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
