import { useState, useEffect, useCallback, useRef } from 'react'
import { getBookmarkTree, flattenBookmarks } from '../../shared/chromeApi'
import {
  getTriageRecords,
  setTriageRecord,
  upsertBookmarkInsight,
  getBookmarkInsight,
  getFolderDescriptions,
  upsertFolderDescription,
} from '../../lib/bookmarkInsightService'
import { fetchPageWithJina, extractSummary } from '../../lib/jinaService'
import type { BookmarkWithMetadata, TriageStatus, FolderDescription } from '../../shared/types'
import { cn, getFaviconUrl, formatRelativeDate, truncateUrl } from '../../shared/utils'

type FilterMode = 'all' | 'folder' | 'unreviewed' | 'kept'

interface FolderOption {
  id: string
  title: string
  path: string
  count: number
}

function buildFolderOptions(nodes: BookmarkWithMetadata[], path = ''): FolderOption[] {
  const options: FolderOption[] = []
  for (const node of nodes) {
    if (!node.url && node.children) {
      const fullPath = path ? `${path} / ${node.title}` : node.title
      const count = node.children.filter((c) => c.url).length
      if (count > 0) {
        options.push({ id: node.id, title: node.title, path: fullPath, count })
      }
      options.push(...buildFolderOptions(node.children, fullPath))
    }
  }
  return options
}

export function Discover() {
  const [allBookmarks, setAllBookmarks] = useState<BookmarkWithMetadata[]>([])
  const [filteredBookmarks, setFilteredBookmarks] = useState<BookmarkWithMetadata[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [triageMap, setTriageMap] = useState<Record<string, { status: TriageStatus }>>({})
  const [filterMode, setFilterMode] = useState<FilterMode>('unreviewed')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [folderOptions, setFolderOptions] = useState<FolderOption[]>([])
  const [folderDescriptions, setFolderDescriptions] = useState<Record<string, FolderDescription>>({})
  const [showFolderPanel, setShowFolderPanel] = useState(false)

  // Card state
  const [pageSummary, setPageSummary] = useState<string | null>(null)
  const [fetchingSummary, setFetchingSummary] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [currentInsight, setCurrentInsight] = useState<{ reason: string; tags: string[] } | null>(null)
  const [animDirection, setAnimDirection] = useState<'left' | 'right' | 'up' | 'down' | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [folderDescInput, setFolderDescInput] = useState('')
  const [folderPriorityInput, setFolderPriorityInput] = useState<FolderDescription['priority']>('medium')

  const cardRef = useRef<HTMLDivElement>(null)
  const summaryCache = useRef<Map<string, string>>(new Map())

  // Load everything
  useEffect(() => {
    async function load() {
      setLoading(true)
      const tree = await getBookmarkTree()
      const flat = flattenBookmarks(tree)
      setAllBookmarks(flat)
      setFolderOptions(buildFolderOptions(tree[0]?.children || []))

      const triage = await getTriageRecords()
      const mapped: Record<string, { status: TriageStatus }> = {}
      for (const [id, rec] of Object.entries(triage)) {
        mapped[id] = { status: rec.status }
      }
      setTriageMap(mapped)

      const fDescs = await getFolderDescriptions()
      setFolderDescriptions(fDescs)
      setLoading(false)
    }
    load()
  }, [])

  // Filter bookmarks
  useEffect(() => {
    let result = [...allBookmarks]

    if (selectedFolder) {
      result = result.filter((b) => b.parentId === selectedFolder)
    }

    if (filterMode === 'unreviewed') {
      result = result.filter((b) => !triageMap[b.id])
    } else if (filterMode === 'kept') {
      result = result.filter((b) => triageMap[b.id]?.status === 'keep')
    }

    setFilteredBookmarks(result)
    setCurrentIndex(0)
  }, [allBookmarks, filterMode, selectedFolder, triageMap])

  const currentBookmark = filteredBookmarks[currentIndex] || null

  // Fetch AI summary for current card
  useEffect(() => {
    if (!currentBookmark?.url) {
      setPageSummary(null)
      return
    }

    const cached = summaryCache.current.get(currentBookmark.url)
    if (cached) {
      setPageSummary(cached)
      return
    }

    setPageSummary(null)
    setFetchingSummary(true)

    fetchPageWithJina(currentBookmark.url).then((result) => {
      if (result) {
        const summary = extractSummary(result.content, 280)
        summaryCache.current.set(currentBookmark.url!, summary)
        setPageSummary(summary)
      }
      setFetchingSummary(false)
    }).catch(() => setFetchingSummary(false))
  }, [currentBookmark?.url])

  // Load existing insight for current card
  useEffect(() => {
    if (!currentBookmark) {
      setCurrentInsight(null)
      return
    }
    getBookmarkInsight(currentBookmark.id).then((insight) => {
      if (insight) {
        setCurrentInsight({ reason: insight.reason, tags: insight.tags })
        setNoteInput(insight.reason)
      } else {
        setCurrentInsight(null)
        setNoteInput('')
      }
    })
  }, [currentBookmark?.id])

  const animateAndAdvance = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    setAnimDirection(direction)
    setTimeout(() => {
      setAnimDirection(null)
      setShowNoteInput(false)
      setNoteInput('')
      setTagInput('')
      setCurrentIndex((i) => Math.min(i + 1, filteredBookmarks.length))
    }, 300)
  }, [filteredBookmarks.length])

  const handleTriage = useCallback(async (status: TriageStatus) => {
    if (!currentBookmark) return

    await setTriageRecord(currentBookmark.id, status, noteInput || undefined)
    setTriageMap((prev) => ({ ...prev, [currentBookmark.id]: { status } }))

    // Save note if provided
    if (noteInput.trim()) {
      await upsertBookmarkInsight(currentBookmark.id, { reason: noteInput.trim() })
    }

    const dirMap: Record<TriageStatus, 'right' | 'left' | 'up' | 'down'> = {
      keep: 'right',
      skip: 'left',
      archive: 'down',
      delete: 'up',
    }
    animateAndAdvance(dirMap[status])

    if (status === 'delete') {
      try {
        await chrome.bookmarks.remove(currentBookmark.id)
      } catch (err) {
        console.error('Delete failed:', err)
      }
    }
  }, [currentBookmark, noteInput, animateAndAdvance])

  const handleAddTag = useCallback(async () => {
    if (!currentBookmark || !tagInput.trim()) return
    const existing = currentInsight?.tags || []
    const newTags = [...existing, tagInput.trim()]
    await upsertBookmarkInsight(currentBookmark.id, { tags: newTags })
    setCurrentInsight((prev) => ({ reason: prev?.reason || '', tags: newTags }))
    setTagInput('')
  }, [currentBookmark, tagInput, currentInsight])

  const handleSaveNote = useCallback(async () => {
    if (!currentBookmark) return
    await upsertBookmarkInsight(currentBookmark.id, { reason: noteInput.trim() })
    setCurrentInsight((prev) => ({ reason: noteInput.trim(), tags: prev?.tags || [] }))
    setShowNoteInput(false)
  }, [currentBookmark, noteInput])

  const handleSaveFolderDesc = useCallback(async () => {
    if (!editingFolderId) return
    await upsertFolderDescription(editingFolderId, folderDescInput, folderPriorityInput)
    setFolderDescriptions((prev) => ({
      ...prev,
      [editingFolderId]: {
        folderId: editingFolderId,
        description: folderDescInput,
        priority: folderPriorityInput,
        updatedAt: new Date().toISOString(),
      },
    }))
    setEditingFolderId(null)
    setFolderDescInput('')
  }, [editingFolderId, folderDescInput, folderPriorityInput])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showNoteInput || editingFolderId) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          handleTriage('keep')
          break
        case 'ArrowLeft':
          e.preventDefault()
          handleTriage('skip')
          break
        case 'ArrowDown':
          e.preventDefault()
          handleTriage('archive')
          break
        case 'ArrowUp':
          e.preventDefault()
          handleTriage('delete')
          break
        case 'n':
          e.preventDefault()
          setShowNoteInput(true)
          break
        case 'o':
          e.preventDefault()
          if (currentBookmark?.url) {
            chrome.tabs.create({ url: currentBookmark.url })
          }
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTriage, showNoteInput, editingFolderId, currentBookmark])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading your bookmarks...</p>
        </div>
      </div>
    )
  }

  const reviewedCount = Object.keys(triageMap).length
  const totalCount = allBookmarks.length
  const progressPct = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Discover</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Swipe through your bookmarks. Keep what matters, archive the rest.
            </p>
          </div>
          <button
            onClick={() => setShowFolderPanel(!showFolderPanel)}
            className={cn(
              'px-3 py-1.5 text-sm border rounded-lg transition-colors',
              showFolderPanel
                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400'
                : 'text-gray-400 border-gray-700 hover:bg-gray-800'
            )}
          >
            Folders
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {reviewedCount} / {totalCount} reviewed
          </span>
        </div>

        {/* Filter bar */}
        <div className="flex gap-2 mt-3">
          {([
            { key: 'unreviewed', label: 'New' },
            { key: 'all', label: 'All' },
            { key: 'kept', label: 'Kept' },
          ] as { key: FilterMode; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilterMode(f.key)}
              className={cn(
                'px-3 py-1 text-xs rounded-full transition-colors',
                filterMode === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
          {selectedFolder && (
            <button
              onClick={() => setSelectedFolder(null)}
              className="px-3 py-1 text-xs rounded-full bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors flex items-center gap-1"
            >
              {folderOptions.find((f) => f.id === selectedFolder)?.title || 'Folder'}
              <span className="text-purple-500">x</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Folder Panel (side drawer) */}
        {showFolderPanel && (
          <div className="w-72 border-r border-gray-800 flex flex-col bg-gray-950/50 flex-shrink-0">
            <div className="px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-medium text-gray-300">Your Folders</h3>
              <p className="text-xs text-gray-600 mt-0.5">Add descriptions to help organize</p>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {folderOptions.map((folder) => {
                const desc = folderDescriptions[folder.id]
                const isEditing = editingFolderId === folder.id
                return (
                  <div key={folder.id} className="rounded-lg hover:bg-gray-800/50 transition-colors">
                    <button
                      onClick={() => {
                        setSelectedFolder(folder.id === selectedFolder ? null : folder.id)
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 flex items-center gap-2',
                        selectedFolder === folder.id && 'text-indigo-400'
                      )}
                    >
                      <svg
                        className={cn('w-4 h-4 flex-shrink-0', selectedFolder === folder.id ? 'text-indigo-400' : 'text-gray-500')}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{folder.title}</p>
                        <p className="text-[10px] text-gray-600">{folder.count} bookmarks</p>
                      </div>
                      {desc && (
                        <span className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                          desc.priority === 'high' ? 'bg-red-900/30 text-red-400' :
                          desc.priority === 'medium' ? 'bg-yellow-900/30 text-yellow-400' :
                          desc.priority === 'low' ? 'bg-gray-800 text-gray-500' :
                          'bg-gray-800 text-gray-600'
                        )}>
                          {desc.priority}
                        </span>
                      )}
                    </button>

                    {desc && !isEditing && (
                      <div
                        onClick={() => {
                          setEditingFolderId(folder.id)
                          setFolderDescInput(desc.description)
                          setFolderPriorityInput(desc.priority)
                        }}
                        className="px-3 pb-2 cursor-pointer"
                      >
                        <p className="text-[11px] text-gray-500 italic leading-relaxed">{desc.description}</p>
                      </div>
                    )}

                    {!desc && !isEditing && (
                      <button
                        onClick={() => {
                          setEditingFolderId(folder.id)
                          setFolderDescInput('')
                          setFolderPriorityInput('medium')
                        }}
                        className="px-3 pb-2 text-[10px] text-gray-600 hover:text-indigo-400 transition-colors"
                      >
                        + add description
                      </button>
                    )}

                    {isEditing && (
                      <div className="px-3 pb-2 space-y-2">
                        <textarea
                          value={folderDescInput}
                          onChange={(e) => setFolderDescInput(e.target.value)}
                          placeholder="What's this folder for? e.g. 'ML research papers I want to implement'"
                          className="w-full text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-200 placeholder:text-gray-600 outline-none focus:border-indigo-500 resize-none"
                          rows={2}
                          autoFocus
                        />
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-600 mr-1">Priority:</span>
                          {(['high', 'medium', 'low', 'none'] as const).map((p) => (
                            <button
                              key={p}
                              onClick={() => setFolderPriorityInput(p)}
                              className={cn(
                                'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                                folderPriorityInput === p
                                  ? p === 'high' ? 'bg-red-600 text-white' :
                                    p === 'medium' ? 'bg-yellow-600 text-white' :
                                    p === 'low' ? 'bg-gray-600 text-white' :
                                    'bg-gray-600 text-white'
                                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                              )}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={handleSaveFolderDesc}
                            className="text-[10px] px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingFolderId(null)}
                            className="text-[10px] px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Main card area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {filteredBookmarks.length === 0 ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-300">
                {filterMode === 'unreviewed' ? 'All caught up!' : 'No bookmarks found'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {filterMode === 'unreviewed'
                  ? "You've reviewed all your bookmarks. Nice work!"
                  : 'Try changing your filter or selecting a different folder.'}
              </p>
              {filterMode === 'unreviewed' && reviewedCount > 0 && (
                <button
                  onClick={() => setFilterMode('all')}
                  className="mt-4 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
                >
                  Review all bookmarks
                </button>
              )}
            </div>
          ) : currentIndex >= filteredBookmarks.length ? (
            <div className="text-center">
              <div className="text-4xl mb-4">
                <span role="img" aria-label="party">&#127881;</span>
              </div>
              <h3 className="text-lg font-medium text-gray-300">Batch complete!</h3>
              <p className="text-sm text-gray-500 mt-1">
                You reviewed {filteredBookmarks.length} bookmark{filteredBookmarks.length !== 1 && 's'} in this session.
              </p>
              <button
                onClick={() => setCurrentIndex(0)}
                className="mt-4 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
              >
                Start over
              </button>
            </div>
          ) : currentBookmark && (
            <div className="w-full max-w-2xl">
              {/* Position indicator */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-gray-600">
                  {currentIndex + 1} of {filteredBookmarks.length}
                </span>
                <div className="flex gap-1">
                  {currentIndex > 0 && (
                    <button
                      onClick={() => {
                        setCurrentIndex((i) => Math.max(0, i - 1))
                        setShowNoteInput(false)
                      }}
                      className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                    >
                      Back
                    </button>
                  )}
                </div>
              </div>

              {/* The Card */}
              <div
                ref={cardRef}
                className={cn(
                  'bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden transition-all duration-300',
                  animDirection === 'right' && 'translate-x-full opacity-0',
                  animDirection === 'left' && '-translate-x-full opacity-0',
                  animDirection === 'up' && '-translate-y-full opacity-0',
                  animDirection === 'down' && 'translate-y-full opacity-0',
                  !animDirection && 'translate-x-0 opacity-100'
                )}
              >
                {/* Card header */}
                <div className="px-6 pt-6 pb-4">
                  <div className="flex items-start gap-4">
                    <img
                      src={currentBookmark.url ? getFaviconUrl(currentBookmark.url) : ''}
                      alt=""
                      className="w-10 h-10 rounded-xl flex-shrink-0 mt-0.5 bg-gray-800"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="%23374151" rx="4"/><text x="10" y="14" text-anchor="middle" fill="%239CA3AF" font-size="10">B</text></svg>'
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-gray-100 leading-tight">
                        {currentBookmark.title || 'Untitled'}
                      </h3>
                      <a
                        href={currentBookmark.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-gray-500 hover:text-indigo-400 transition-colors mt-1 block truncate"
                      >
                        {currentBookmark.url ? truncateUrl(currentBookmark.url, 60) : ''}
                      </a>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                          {formatRelativeDate(currentBookmark.dateAdded)}
                        </span>
                        {currentBookmark.parentId && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/30 text-indigo-400">
                            {folderOptions.find((f) => f.id === currentBookmark.parentId)?.title || 'Bookmarks'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Summary */}
                <div className="px-6 pb-4">
                  <div className="bg-gray-800/50 rounded-xl px-4 py-3">
                    {fetchingSummary ? (
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-gray-500">Fetching page summary...</span>
                      </div>
                    ) : pageSummary ? (
                      <div>
                        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 font-medium">AI Summary</p>
                        <p className="text-sm text-gray-300 leading-relaxed">{pageSummary}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 italic">Could not fetch page content</p>
                    )}
                  </div>
                </div>

                {/* Existing notes & tags */}
                {currentInsight && (currentInsight.reason || currentInsight.tags.length > 0) && (
                  <div className="px-6 pb-4">
                    {currentInsight.reason && (
                      <div className="mb-2">
                        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 font-medium">Your Note</p>
                        <p className="text-sm text-gray-400 italic">{currentInsight.reason}</p>
                      </div>
                    )}
                    {currentInsight.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {currentInsight.tags.map((tag) => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Note input (expanded) */}
                {showNoteInput && (
                  <div className="px-6 pb-4 space-y-2">
                    <textarea
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Why did you save this? What's it about?"
                      className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 placeholder:text-gray-600 outline-none focus:border-indigo-500 resize-none"
                      rows={2}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSaveNote()
                        }
                        if (e.key === 'Escape') setShowNoteInput(false)
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder="Add tag..."
                        className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-gray-200 placeholder:text-gray-600 outline-none focus:border-indigo-500 w-32"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddTag()
                          }
                        }}
                      />
                      <button
                        onClick={handleSaveNote}
                        className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setShowNoteInput(false)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
                  <div className="flex items-center justify-center gap-3">
                    <ActionButton
                      label="Delete"
                      shortcut="up-arrow"
                      color="red"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      }
                      onClick={() => handleTriage('delete')}
                    />
                    <ActionButton
                      label="Skip"
                      shortcut="left-arrow"
                      color="gray"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      }
                      onClick={() => handleTriage('skip')}
                    />
                    <button
                      onClick={() => setShowNoteInput(!showNoteInput)}
                      className="w-14 h-14 rounded-2xl bg-gray-800 border-2 border-gray-700 flex items-center justify-center hover:border-indigo-500 hover:bg-indigo-900/20 transition-all group"
                      title="Add note (N)"
                    >
                      <svg className="w-6 h-6 text-gray-400 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <ActionButton
                      label="Keep"
                      shortcut="right-arrow"
                      color="green"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      }
                      onClick={() => handleTriage('keep')}
                    />
                    <ActionButton
                      label="Archive"
                      shortcut="down-arrow"
                      color="yellow"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      }
                      onClick={() => handleTriage('archive')}
                    />
                  </div>
                  <p className="text-center text-[10px] text-gray-600 mt-3">
                    Use arrow keys or click. Press <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">N</kbd> for notes, <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">O</kbd> to open.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  label,
  shortcut,
  color,
  icon,
  onClick,
}: {
  label: string
  shortcut: string
  color: 'red' | 'green' | 'yellow' | 'gray'
  icon: React.ReactNode
  onClick: () => void
}) {
  const colorMap = {
    red: 'hover:border-red-500 hover:bg-red-900/20 group-hover:text-red-400',
    green: 'hover:border-emerald-500 hover:bg-emerald-900/20 group-hover:text-emerald-400',
    yellow: 'hover:border-yellow-500 hover:bg-yellow-900/20 group-hover:text-yellow-400',
    gray: 'hover:border-gray-500 hover:bg-gray-700/30 group-hover:text-gray-300',
  }
  const iconColorMap = {
    red: 'group-hover:text-red-400',
    green: 'group-hover:text-emerald-400',
    yellow: 'group-hover:text-yellow-400',
    gray: 'group-hover:text-gray-300',
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-12 h-12 rounded-xl bg-gray-800 border-2 border-gray-700 flex flex-col items-center justify-center transition-all group',
        colorMap[color]
      )}
      title={`${label} (${shortcut})`}
    >
      <svg className={cn('w-5 h-5 text-gray-400 transition-colors', iconColorMap[color])} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icon}
      </svg>
    </button>
  )
}
