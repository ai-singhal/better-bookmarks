import { useCallback, useEffect, useState, useRef } from 'react'
import { useBookmarkStore } from '../../shared/store'
import { getBookmarkTree, countBookmarks } from '../../shared/chromeApi'
import type { BookmarkWithMetadata } from '../../shared/types'
import { BookmarkTreeNode } from '../components/BookmarkTreeNode'
import { executeActions, getOpenAIKey, streamAI, type AIAction, type AIResponse } from '../../lib/openaiService'
import { cn } from '../../shared/utils'

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

function isDescendantFolder(
  nodes: BookmarkWithMetadata[],
  ancestorId: string,
  candidateId: string
): boolean {
  const findNode = (items: BookmarkWithMetadata[], id: string): BookmarkWithMetadata | null => {
    for (const item of items) {
      if (item.id === id) return item
      if (item.children?.length) {
        const nested = findNode(item.children, id)
        if (nested) return nested
      }
    }
    return null
  }

  const ancestor = findNode(nodes, ancestorId)
  if (!ancestor?.children?.length) return false

  const walk = (items: BookmarkWithMetadata[]): boolean => {
    for (const item of items) {
      if (item.id === candidateId) return true
      if (item.children?.length && walk(item.children)) return true
    }
    return false
  }

  return walk(ancestor.children)
}

function countNodeContents(node: BookmarkWithMetadata): { bookmarks: number; folders: number } {
  if (node.url) return { bookmarks: 1, folders: 0 }

  let bookmarks = 0
  let folders = 1
  for (const child of node.children || []) {
    const counts = countNodeContents(child)
    bookmarks += counts.bookmarks
    folders += counts.folders
  }
  return { bookmarks, folders }
}

function serializeNodeSubtree(node: BookmarkWithMetadata, depth = 0): string {
  const indent = '  '.repeat(depth)
  if (node.url) {
    return `${indent}[B:${node.id}] ${node.title} | ${node.url}`
  }

  const lines = [`${indent}[F:${node.id}] ${node.title}`]
  for (const child of node.children || []) {
    lines.push(serializeNodeSubtree(child, depth + 1))
  }
  return lines.join('\n')
}

function buildNodeTitleMap(nodes: BookmarkWithMetadata[], map = new Map<string, string>()) {
  for (const node of nodes) {
    map.set(node.id, node.title || 'Untitled')
    if (node.children?.length) {
      buildNodeTitleMap(node.children, map)
    }
  }
  return map
}

function formatTreeActionPreview(action: AIAction, titleMap: Map<string, string>) {
  switch (action.type) {
    case 'create_folder':
      return `Create "${action.title || 'New Folder'}"${action.parentId ? ` inside "${titleMap.get(action.parentId) || action.parentId}"` : ''}`
    case 'move':
      return `"${titleMap.get(action.bookmarkId || '') || action.bookmarkId}" -> "${titleMap.get(action.destinationFolderId || '') || action.destinationFolderId}"`
    case 'rename':
      return `Rename "${titleMap.get(action.bookmarkId || '') || action.bookmarkId}" -> "${action.title}"`
    case 'delete':
      return `Delete "${titleMap.get(action.bookmarkId || '') || action.bookmarkId}"`
    case 'reorder':
      return `"${titleMap.get(action.bookmarkId || '') || action.bookmarkId}" -> position ${action.index} in "${titleMap.get(action.parentId || '') || action.parentId}"`
    default:
      return action.type
  }
}

export function BookmarkTree() {
  const bookmarkTree = useBookmarkStore((s) => s.bookmarkTree)
  const setBookmarkTree = useBookmarkStore((s) => s.setBookmarkTree)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ bookmarks: 0, folders: 0 })
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [aiTargetNode, setAiTargetNode] = useState<BookmarkWithMetadata | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiExecuting, setAiExecuting] = useState(false)
  const [aiExecutionResult, setAiExecutionResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null)

  // Drag-and-drop reorder state
  const dragNodeRef = useRef<BookmarkWithMetadata | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'above' | 'below' | 'inside' | null>(null)
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

  const clearDragState = useCallback(() => {
    dragNodeRef.current = null
    setDragOverId(null)
    setDragPosition(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, targetNode: BookmarkWithMetadata) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const dragNode = dragNodeRef.current
    if (!dragNode || dragNode.id === targetNode.id) return
    const roots = bookmarkTree[0]?.children || bookmarkTree
    if (!dragNode.url && isDescendantFolder(roots, dragNode.id, targetNode.id)) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const upperThreshold = rect.top + rect.height * 0.3
    const lowerThreshold = rect.top + rect.height * 0.7

    setDragOverId(targetNode.id)
    if (!targetNode.url && e.clientY > upperThreshold && e.clientY < lowerThreshold) {
      setDragPosition('inside')
      return
    }

    setDragPosition(e.clientY < rect.top + rect.height / 2 ? 'above' : 'below')
  }, [bookmarkTree])

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: BookmarkWithMetadata) => {
    e.preventDefault()
    const dragNode = dragNodeRef.current
    if (!dragNode || dragNode.id === targetNode.id) return
    const roots = bookmarkTree[0]?.children || bookmarkTree
    if (!dragNode.url && isDescendantFolder(roots, dragNode.id, targetNode.id)) {
      clearDragState()
      return
    }

    try {
      let destination: { parentId?: string; index?: number } | null = null

      if (dragPosition === 'inside' && !targetNode.url) {
        destination = {
          parentId: targetNode.id,
          index: targetNode.children?.length ?? 0,
        }
      } else {
        const parentId = targetNode.parentId
        if (!parentId) {
          clearDragState()
          return
        }

        const targetIndex = targetNode.index ?? 0
        destination = {
          parentId,
          index: dragPosition === 'below' ? targetIndex + 1 : targetIndex,
        }
      }

      if (!destination?.parentId) {
        clearDragState()
        return
      }

      await chrome.bookmarks.move(dragNode.id, destination)
      suppressedMoveIdsRef.current.set(dragNode.id, Date.now())
      await loadBookmarks(false)
    } catch (err) {
      console.error('Reorder failed:', err)
    } finally {
      clearDragState()
    }
  }, [bookmarkTree, clearDragState, dragPosition, loadBookmarks])

  useEffect(() => {
    void loadBookmarks(true)
    getOpenAIKey()
      .then((key) => setHasApiKey(!!key))
      .catch(() => setHasApiKey(false))
  }, [loadBookmarks])

  useEffect(() => {
    if (!aiTargetNode) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAiTargetNode(null)
        setAiPrompt('')
        setAiResponse(null)
        setAiExecutionResult(null)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [aiTargetNode])

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
  const nodeTitleMap = buildNodeTitleMap(rootChildren)

  const buildNodeAiContext = (node: BookmarkWithMetadata) => {
    const counts = countNodeContents(node)
    const parentTitle = node.parentId ? nodeTitleMap.get(node.parentId) || node.parentId : 'Root'

    return [
      'Focused selection for this request:',
      `${node.url ? '[Bookmark]' : '[Folder]'} ${node.title || 'Untitled'} (${node.id})`,
      `Parent: ${parentTitle}`,
      node.url ? `URL: ${node.url}` : `Contains: ${Math.max(counts.bookmarks, 0)} bookmarks and ${Math.max(counts.folders - 1, 0)} subfolders`,
      'Subtree:',
      serializeNodeSubtree(node),
      'Prefer actions that only affect this selected bookmark or this folder subtree unless the user explicitly asks for broader changes.',
    ].join('\n')
  }

  const handleOpenNodeAI = (node: BookmarkWithMetadata) => {
    setAiTargetNode(node)
    setAiPrompt('')
    setAiResponse(null)
    setAiExecutionResult(null)
  }

  const handleAskNodeAI = async () => {
    const prompt = aiPrompt.trim()
    if (!aiTargetNode || !prompt || aiLoading) return

    setAiLoading(true)
    setAiResponse({ message: 'Thinking…', actions: [] })
    setAiExecutionResult(null)

    try {
      const response = await streamAI(
        prompt,
        bookmarkTree,
        [],
        {
          onMessage: (content) => {
            setAiResponse((prev) => ({
              message: content || 'Thinking…',
              actions: prev?.actions || [],
              searchResults: prev?.searchResults,
            }))
          },
        },
        {
          additionalContext: buildNodeAiContext(aiTargetNode),
        }
      )
      setAiResponse(response)
    } catch (err) {
      setAiResponse({
        message: err instanceof Error ? err.message : 'Something went wrong.',
        actions: [],
      })
    } finally {
      setAiLoading(false)
    }
  }

  const handleRunNodeAIActions = async () => {
    if (!aiResponse) return
    const executableActions = aiResponse.actions.filter((action) => action.type !== 'search_results')
    if (executableActions.length === 0 || aiExecuting) return

    setAiExecuting(true)
    try {
      const result = await executeActions(executableActions)
      setAiExecutionResult(result)
      await loadBookmarks(false)
    } finally {
      setAiExecuting(false)
    }
  }

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
              className="px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1h-2V8H4v8h5v2H4a2 2 0 01-2-2V6z" />
                <path d="M14 11V8h2v3h3v2h-3v3h-2v-3h-3v-2h3z" />
              </svg>
              New Folder
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
            onAskAI={handleOpenNodeAI}
            onDragStart={handleDragStart}
            onDragEnd={clearDragState}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragOverId={dragOverId}
            dragPosition={dragPosition}
          />
        ))}
      </div>

      {aiTargetNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm p-6">
          <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-5 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-400">
                  Bookmark Tree AI
                </p>
                <h3 className="mt-1 text-lg font-semibold text-gray-100">
                  {aiTargetNode.title || 'Untitled'}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {aiTargetNode.url
                    ? 'Ask AI how to rename, move, or clean up this bookmark.'
                    : 'Ask AI how to organize this folder, create subfolders, or reorder its contents.'}
                </p>
              </div>
              <button
                onClick={() => {
                  setAiTargetNode(null)
                  setAiPrompt('')
                  setAiResponse(null)
                  setAiExecutionResult(null)
                }}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              {hasApiKey === false ? (
                <div className="rounded-xl border border-gray-800 bg-gray-950/70 px-4 py-3 text-sm text-gray-400">
                  Add your OpenAI API key in Settings to use bookmark-tree AI actions.
                </div>
              ) : (
                <>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        void handleAskNodeAI()
                      }
                    }}
                    rows={4}
                    autoFocus
                    placeholder={aiTargetNode.url
                      ? 'Example: move this into my ML folder and rename it to be clearer'
                      : 'Example: split this folder into cleaner subfolders and put the most important links first'}
                    className="w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-600 outline-none focus:border-cyan-500"
                  />

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500">
                      Press Ctrl/Cmd + Enter to ask. Actions are previewed before anything runs.
                    </p>
                    <button
                      onClick={() => void handleAskNodeAI()}
                      disabled={!aiPrompt.trim() || aiLoading}
                      className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500"
                    >
                      {aiLoading ? 'Asking…' : 'Ask AI'}
                    </button>
                  </div>
                </>
              )}

              {aiResponse && (
                <div className="rounded-xl border border-gray-800 bg-gray-950/70 px-4 py-3">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-200">
                    {aiResponse.message}
                  </p>

                  {aiResponse.actions.filter((action) => action.type !== 'search_results').length > 0 && (
                    <div className="mt-4 border-t border-gray-800 pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-wider text-gray-500">
                          Planned changes
                        </p>
                        <button
                          onClick={() => void handleRunNodeAIActions()}
                          disabled={aiExecuting}
                          className={cn(
                            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                            aiExecuting
                              ? 'bg-gray-700 text-gray-400'
                              : 'bg-indigo-600 text-white hover:bg-indigo-500'
                          )}
                        >
                          {aiExecuting ? 'Running…' : 'Run actions'}
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {aiResponse.actions
                          .filter((action) => action.type !== 'search_results')
                          .map((action, index) => (
                            <div key={`${action.type}-${index}`} className="flex items-center gap-2 text-xs text-gray-400">
                              <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-gray-300">
                                {action.type}
                              </span>
                              <span className="truncate">
                                {formatTreeActionPreview(action, nodeTitleMap)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {aiExecutionResult && (
                    <div className="mt-4 border-t border-gray-800 pt-4">
                      <p className="text-xs text-emerald-400">
                        {aiExecutionResult.success} succeeded
                        {aiExecutionResult.failed > 0 ? `, ${aiExecutionResult.failed} failed` : ''}
                      </p>
                      {aiExecutionResult.errors.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {aiExecutionResult.errors.map((error, index) => (
                            <p key={index} className="text-[11px] text-red-400">{error}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
