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
import { getOpenAIKey, streamAI, executeActions, type AIAction, type AIResponse } from '../../lib/openaiService'
import { confirmSnapshotProtection } from '../../lib/aiActionSafety'
import type { BookmarkWithMetadata, TriageStatus, FolderDescription } from '../../shared/types'
import { cn, getFaviconUrl, formatRelativeDate, truncateUrl } from '../../shared/utils'

type FilterMode = 'all' | 'folder' | 'unreviewed' | 'kept'

interface FolderOption {
  id: string
  title: string
  path: string
  count: number
}

interface DiscoverAiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  response?: AIResponse
  executionResult?: { success: number; failed: number; errors: string[] }
  executing?: boolean
  streaming?: boolean
  rawContent?: string
}

function buildDiscoverAIPrompt(
  bookmark: BookmarkWithMetadata,
  userQuery: string,
  options: {
    folderName?: string
    note?: string
    pageSummary?: string | null
  }
): string {
  return `You are helping from the Discover page with one specific bookmark. Focus on this bookmark unless the user explicitly asks you to work across other bookmarks or folders.

Current bookmark:
- Bookmark ID: ${bookmark.id}
- Title: ${bookmark.title || 'Untitled'}
- URL: ${bookmark.url || 'N/A'}
- Current folder: ${options.folderName || 'Unknown'}
- Saved note: ${options.note?.trim() || 'None'}
- Page summary: ${options.pageSummary?.trim() || 'Unavailable'}

When the user asks you to change something, prefer actions that operate on this bookmark.

User request:
${userQuery}`
}

function hasExecutableActions(actions: AIAction[]): boolean {
  return actions.some((action) => action.type !== 'search_results')
}

function getActionSummary(actions: AIAction[]): string {
  const counts: Record<string, number> = {}
  for (const action of actions) {
    if (action.type === 'search_results') continue
    counts[action.type] = (counts[action.type] || 0) + 1
  }

  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
    .join(', ')
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
  const [bookmarkTree, setBookmarkTree] = useState<BookmarkWithMetadata[]>([])
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
  const [hasAiKey, setHasAiKey] = useState<boolean | null>(null)
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiThreads, setAiThreads] = useState<Record<string, DiscoverAiMessage[]>>({})
  const [expandedAiActionMessageIds, setExpandedAiActionMessageIds] = useState<Set<string>>(new Set())

  // Card state
  const [pageSummary, setPageSummary] = useState<string | null>(null)
  const [fetchingSummary, setFetchingSummary] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [renameInput, setRenameInput] = useState('')
  const [isRenamingBookmark, setIsRenamingBookmark] = useState(false)
  const [currentInsight, setCurrentInsight] = useState<{ reason: string; tags: string[] } | null>(null)
  const [animDirection, setAnimDirection] = useState<'left' | 'right' | 'up' | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [folderDescInput, setFolderDescInput] = useState('')
  const [folderPriorityInput, setFolderPriorityInput] = useState<FolderDescription['priority']>('medium')
  const currentBookmark = filteredBookmarks[currentIndex] || null

  const cardRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const aiScrollRef = useRef<HTMLDivElement>(null)
  const summaryCache = useRef<Map<string, string>>(new Map())
  const currentBookmarkIdRef = useRef<string | null>(null)
  const currentIndexRef = useRef(0)
  const preferredBookmarkIdRef = useRef<string | null>(null)
  const forceResetIndexRef = useRef(false)

  useEffect(() => {
    currentBookmarkIdRef.current = currentBookmark?.id ?? null
  }, [currentBookmark?.id])

  useEffect(() => {
    setIsRenamingBookmark(false)
    setRenameInput(currentBookmark?.title || '')
  }, [currentBookmark?.id, currentBookmark?.title])

  useEffect(() => {
    if (isRenamingBookmark) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenamingBookmark])

  useEffect(() => {
    setAiInput('')
  }, [currentBookmark?.id])

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  const currentAiMessages = currentBookmark ? (aiThreads[currentBookmark.id] || []) : []

  useEffect(() => {
    aiScrollRef.current?.scrollTo({ top: aiScrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [currentAiMessages])

  const reloadBookmarkSnapshot = useCallback(async () => {
    const tree = await getBookmarkTree()
    setBookmarkTree(tree)
    const flat = flattenBookmarks(tree)
    setAllBookmarks(flat)
    setFolderOptions(buildFolderOptions(tree[0]?.children || []))
  }, [])

  // Load everything
  useEffect(() => {
    async function load() {
      setLoading(true)
      await reloadBookmarkSnapshot()

      const triage = await getTriageRecords()
      const mapped: Record<string, { status: TriageStatus }> = {}
      for (const [id, rec] of Object.entries(triage)) {
        if (rec.status === 'keep' || rec.status === 'delete') {
          mapped[id] = { status: rec.status }
        }
      }
      setTriageMap(mapped)

      const fDescs = await getFolderDescriptions()
      setFolderDescriptions(fDescs)

      const key = await getOpenAIKey()
      setHasAiKey(!!key)
      setLoading(false)
    }
    load()
  }, [reloadBookmarkSnapshot])

  useEffect(() => {
    const listener = (message: { type: string }) => {
      if (message.type.startsWith('BOOKMARK_')) {
        void reloadBookmarkSnapshot()
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [reloadBookmarkSnapshot])

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
    setCurrentIndex(() => {
      if (result.length === 0) return 0

      if (forceResetIndexRef.current) {
        forceResetIndexRef.current = false
        return 0
      }

      const preferredId = preferredBookmarkIdRef.current
      if (preferredId) {
        const preferredIndex = result.findIndex((bookmark) => bookmark.id === preferredId)
        preferredBookmarkIdRef.current = null
        if (preferredIndex >= 0) return preferredIndex
      }

      const currentId = currentBookmarkIdRef.current
      if (currentId) {
        const existingIndex = result.findIndex((bookmark) => bookmark.id === currentId)
        if (existingIndex >= 0) return existingIndex
      }

      return Math.min(currentIndexRef.current, result.length - 1)
    })
  }, [allBookmarks, filterMode, selectedFolder, triageMap])

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

  const animateCard = useCallback((direction: 'left' | 'right' | 'up', afterAnimation?: () => void) => {
    setAnimDirection(direction)
    setTimeout(() => {
      setAnimDirection(null)
      setShowNoteInput(false)
      setTagInput('')
      afterAnimation?.()
    }, 220)
  }, [])

  const goToPrevious = useCallback(() => {
    if (currentIndex <= 0) return

    animateCard('right', () => {
      setCurrentIndex((index) => Math.max(0, index - 1))
    })
  }, [animateCard, currentIndex])

  const goToNext = useCallback(() => {
    if (filteredBookmarks.length === 0) return

    animateCard('left', () => {
      setCurrentIndex((index) => Math.min(index + 1, filteredBookmarks.length))
    })
  }, [animateCard, filteredBookmarks.length])

  const handleReview = useCallback(async (status: TriageStatus) => {
    if (!currentBookmark) return

    preferredBookmarkIdRef.current =
      filteredBookmarks[currentIndex + 1]?.id ??
      filteredBookmarks[currentIndex - 1]?.id ??
      null

    await setTriageRecord(currentBookmark.id, status, noteInput || undefined)
    setTriageMap((prev) => ({ ...prev, [currentBookmark.id]: { status } }))

    // Save note if provided
    if (noteInput.trim()) {
      await upsertBookmarkInsight(currentBookmark.id, { reason: noteInput.trim() })
    }

    animateCard(status === 'keep' ? 'right' : 'up')

    if (status === 'delete') {
      try {
        await chrome.bookmarks.remove(currentBookmark.id)
        setAllBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== currentBookmark.id))
      } catch (err) {
        console.error('Delete failed:', err)
      }
    }
  }, [animateCard, currentBookmark, currentIndex, filteredBookmarks, noteInput])

  const handleSkip = useCallback(() => {
    goToNext()
  }, [goToNext])

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

  const handleSaveRename = useCallback(async () => {
    if (!currentBookmark) return

    const trimmed = renameInput.trim()
    if (!trimmed) {
      setRenameInput(currentBookmark.title || '')
      setIsRenamingBookmark(false)
      return
    }

    if (trimmed === currentBookmark.title) {
      setIsRenamingBookmark(false)
      return
    }

    try {
      await chrome.bookmarks.update(currentBookmark.id, { title: trimmed })
      setAllBookmarks((prev) => prev.map((bookmark) => (
        bookmark.id === currentBookmark.id
          ? { ...bookmark, title: trimmed }
          : bookmark
      )))
      setIsRenamingBookmark(false)
    } catch (err) {
      console.error('Rename failed:', err)
      setRenameInput(currentBookmark.title || '')
      setIsRenamingBookmark(false)
    }
  }, [currentBookmark, renameInput])

  const handleAskBookmarkAI = useCallback(async () => {
    const query = aiInput.trim()
    if (!currentBookmark || !query || aiLoading) return

    const bookmarkId = currentBookmark.id
    const userMessageId = `discover-ai-user-${Date.now()}`
    const assistantMessageId = `discover-ai-assistant-${Date.now()}`
    const folderName = currentBookmark.parentId
      ? folderOptions.find((folder) => folder.id === currentBookmark.parentId)?.title || 'Bookmarks'
      : 'Bookmarks'
    const prompt = buildDiscoverAIPrompt(currentBookmark, query, {
      folderName,
      note: currentInsight?.reason,
      pageSummary,
    })

    const existingThread = aiThreads[bookmarkId] || []
    const history = existingThread.slice(-6).map((message) => ({
      role: message.role,
      content: message.role === 'assistant' && message.response
        ? message.response.message
        : message.content,
    }))

    const userMessage: DiscoverAiMessage = {
      id: userMessageId,
      role: 'user',
      content: query,
    }

    const assistantMessage: DiscoverAiMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: 'Thinking…',
      streaming: true,
      rawContent: '',
    }

    setAiInput('')
    setAiLoading(true)
    setAiThreads((prev) => ({
      ...prev,
      [bookmarkId]: [...(prev[bookmarkId] || []), userMessage, assistantMessage],
    }))

    try {
      const response = await streamAI(prompt, bookmarkTree, history, {
        onMessage: (content, rawContent) => {
          setAiThreads((prev) => ({
            ...prev,
            [bookmarkId]: (prev[bookmarkId] || []).map((message) => (
              message.id === assistantMessageId
                ? {
                    ...message,
                    content: content || 'Thinking…',
                    rawContent,
                    streaming: true,
                  }
                : message
            )),
          }))
        },
      })

      setAiThreads((prev) => ({
        ...prev,
        [bookmarkId]: (prev[bookmarkId] || []).map((message) => (
          message.id === assistantMessageId
            ? {
                ...message,
                content: response.message || message.content,
                response,
                streaming: false,
                rawContent: undefined,
              }
            : message
        )),
      }))
    } catch (err) {
      setAiThreads((prev) => ({
        ...prev,
        [bookmarkId]: (prev[bookmarkId] || []).map((message) => (
          message.id === assistantMessageId
            ? {
                ...message,
                content: err instanceof Error ? err.message : 'Something went wrong.',
                streaming: false,
                rawContent: undefined,
              }
            : message
        )),
      }))
    } finally {
      setAiLoading(false)
    }
  }, [aiInput, aiLoading, aiThreads, bookmarkTree, currentBookmark, currentInsight?.reason, folderOptions, pageSummary])

  const handleExecuteAiActions = useCallback(async (messageId: string) => {
    if (!currentBookmark) return

    const thread = aiThreads[currentBookmark.id] || []
    const targetMessage = thread.find((message) => message.id === messageId)
    if (!targetMessage?.response?.actions?.length) return

    const executableActions = targetMessage.response.actions.filter((action) => action.type !== 'search_results')
    if (executableActions.length === 0) return
    if (!(await confirmSnapshotProtection(executableActions))) return

    setAiThreads((prev) => ({
      ...prev,
      [currentBookmark.id]: (prev[currentBookmark.id] || []).map((message) => (
        message.id === messageId
          ? { ...message, executing: true }
          : message
      )),
    }))

    const result = await executeActions(executableActions)
    await reloadBookmarkSnapshot()

    setAiThreads((prev) => ({
      ...prev,
      [currentBookmark.id]: (prev[currentBookmark.id] || []).map((message) => (
        message.id === messageId
          ? { ...message, executing: false, executionResult: result }
          : message
      )),
    }))
  }, [aiThreads, currentBookmark, reloadBookmarkSnapshot])

  const toggleExpandedAiActions = useCallback((messageId: string) => {
    setExpandedAiActionMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

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
      if (showNoteInput || editingFolderId || isRenamingBookmark) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          goToNext()
          break
        case 'ArrowLeft':
          e.preventDefault()
          goToPrevious()
          break
        case 'ArrowUp':
          e.preventDefault()
          handleReview('delete')
          break
        case 'k':
          e.preventDefault()
          handleReview('keep')
          break
        case 's':
          e.preventDefault()
          handleSkip()
          break
        case 'd':
          e.preventDefault()
          handleReview('delete')
          break
        case 'n':
          e.preventDefault()
          setShowNoteInput(true)
          break
        case 'r':
          e.preventDefault()
          setIsRenamingBookmark(true)
          setRenameInput(currentBookmark?.title || '')
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
  }, [goToNext, goToPrevious, handleReview, handleSkip, showNoteInput, editingFolderId, isRenamingBookmark, currentBookmark])

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
              Review your bookmarks like flashcards. Keep what matters, skip for later, or delete the junk.
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
              onClick={() => {
                forceResetIndexRef.current = true
                preferredBookmarkIdRef.current = null
                setFilterMode(f.key)
              }}
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
                        forceResetIndexRef.current = true
                        preferredBookmarkIdRef.current = null
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
                onClick={() => {
                  forceResetIndexRef.current = true
                  preferredBookmarkIdRef.current = null
                  setCurrentIndex(0)
                }}
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
                <div className="flex gap-2">
                  <button
                    onClick={goToPrevious}
                    disabled={currentIndex === 0}
                    className="text-xs text-gray-400 px-2.5 py-1 rounded border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={goToNext}
                    className="text-xs text-gray-400 px-2.5 py-1 rounded border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition-colors"
                  >
                    Next
                  </button>
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
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {isRenamingBookmark ? (
                            <div className="space-y-2">
                              <input
                                ref={renameInputRef}
                                type="text"
                                value={renameInput}
                                onChange={(e) => setRenameInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void handleSaveRename()
                                  }
                                  if (e.key === 'Escape') {
                                    setRenameInput(currentBookmark.title || '')
                                    setIsRenamingBookmark(false)
                                  }
                                }}
                                className="w-full rounded-lg border border-indigo-500 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => void handleSaveRename()}
                                  className="text-[11px] px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setRenameInput(currentBookmark.title || '')
                                    setIsRenamingBookmark(false)
                                  }}
                                  className="text-[11px] px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <h3 className="text-base font-semibold text-gray-100 leading-tight">
                              {currentBookmark.title || 'Untitled'}
                            </h3>
                          )}
                        </div>
                        {!isRenamingBookmark && (
                          <button
                            onClick={() => {
                              setIsRenamingBookmark(true)
                              setRenameInput(currentBookmark.title || '')
                            }}
                            className="mt-0.5 rounded-lg border border-gray-800 p-2 text-gray-500 hover:border-indigo-500 hover:text-indigo-400 hover:bg-indigo-900/20 transition-colors"
                            title="Rename bookmark (R)"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                      </div>
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

                <div className="px-6 pb-4">
                  <div className="rounded-xl border border-gray-800 bg-gray-950/50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-400">Discover AI</p>
                        <p className="text-xs text-gray-500 mt-1">Ask AI to act on this bookmark or help you decide what to do with it.</p>
                      </div>
                      <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9.5 4.5a3.5 3.5 0 00-3.5 3.5v.5a3 3 0 00-2 2.828V13a3 3 0 003 3h.25a2.75 2.75 0 002.5 2h.5A2.75 2.75 0 0013 16h.5a2.5 2.5 0 002.5-2.5V13h.25a3 3 0 003-3v-1.672A3 3 0 0017 5.5V5a3.5 3.5 0 00-6.362-2.044A3.48 3.48 0 009.5 4.5zm-1 4.25h.5m6.5 0h.5M9 12.5h1m4 0h1M12 4v10" />
                        </svg>
                      </div>
                    </div>

                    {hasAiKey === false ? (
                      <div className="px-4 py-4">
                        <p className="text-sm text-gray-400">Add your OpenAI API key in Settings to use bookmark-specific AI in Discover.</p>
                      </div>
                    ) : (
                      <div className="px-4 py-4 space-y-3">
                        {currentAiMessages.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 px-3 py-3">
                            <p className="text-sm text-gray-400">Try prompts like “rename this to something cleaner” or “should I keep this bookmark?”</p>
                          </div>
                        ) : (
                          <div ref={aiScrollRef} className="max-h-56 overflow-y-auto space-y-2 pr-1">
                            {currentAiMessages.map((message) => (
                              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                                <div
                                  className={cn(
                                    'max-w-[88%] rounded-2xl px-3 py-2',
                                    message.role === 'user'
                                      ? 'bg-cyan-500 text-gray-950'
                                      : 'bg-gray-800 text-gray-200'
                                  )}
                                >
                                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>

                                  {message.streaming && (
                                    <p className="mt-2 text-[10px] text-gray-400">Streaming…</p>
                                  )}

                                  {message.response && hasExecutableActions(message.response.actions) && !message.executionResult && (
                                    <div className="mt-3 rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Pending actions</p>
                                          <p className="text-xs text-gray-300 mt-1">
                                            {getActionSummary(message.response.actions)}
                                          </p>
                                        </div>
                                        <button
                                          onClick={() => void handleExecuteAiActions(message.id)}
                                          disabled={message.executing}
                                          className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500 text-gray-950 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
                                        >
                                          {message.executing ? 'Running…' : 'Run actions'}
                                        </button>
                                      </div>

                                      {(() => {
                                        const executableActions = message.response.actions.filter((action) => action.type !== 'search_results')
                                        const expanded = expandedAiActionMessageIds.has(message.id)
                                        const visibleActions = expanded ? executableActions : executableActions.slice(0, 3)

                                        return (
                                          <>
                                            <div className="mt-3 space-y-2">
                                              {visibleActions.map((action, index) => (
                                                <div key={`${message.id}-${index}`} className="rounded-lg bg-gray-800/70 px-2.5 py-2 text-xs text-gray-300">
                                                  <span className="font-medium text-cyan-300">{action.type}</span>
                                                  {action.title ? `: ${action.title}` : ''}
                                                  {action.bookmarkId ? ` • ${action.bookmarkId}` : ''}
                                                  {action.destinationFolderId ? ` -> ${action.destinationFolderId}` : ''}
                                                </div>
                                              ))}
                                            </div>
                                            {executableActions.length > 3 && (
                                              <button
                                                onClick={() => toggleExpandedAiActions(message.id)}
                                                className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                                              >
                                                {expanded ? 'Show fewer actions' : `Show all ${executableActions.length} actions`}
                                              </button>
                                            )}
                                          </>
                                        )
                                      })()}
                                    </div>
                                  )}

                                  {message.executionResult && (
                                    <div className="mt-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
                                      Applied {message.executionResult.success} action{message.executionResult.success !== 1 && 's'}
                                      {message.executionResult.failed > 0 && `, ${message.executionResult.failed} failed`}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={aiInput}
                            onChange={(e) => setAiInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void handleAskBookmarkAI()
                              }
                            }}
                            placeholder="Ask AI what to do with this bookmark..."
                            className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 outline-none focus:border-cyan-500"
                          />
                          <button
                            onClick={() => void handleAskBookmarkAI()}
                            disabled={!aiInput.trim() || aiLoading}
                            className="px-4 py-2 rounded-xl bg-cyan-500 text-gray-950 text-sm font-medium hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
                          >
                            {aiLoading ? 'Asking…' : 'Ask'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
                  <div className="flex items-center justify-center gap-3">
                    <ActionButton
                      label="Delete"
                      description="Remove this bookmark from Chrome."
                      shortcut="D"
                      color="red"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      }
                      onClick={() => handleReview('delete')}
                    />
                    <ActionButton
                      label="Skip"
                      description="Leave it unreviewed and move to the next bookmark."
                      shortcut="S"
                      color="gray"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      }
                      onClick={handleSkip}
                    />
                    <ActionButton
                      label="Note"
                      description="Add context, tags, or a reminder for why you saved it."
                      shortcut="N"
                      color="indigo"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      }
                      onClick={() => setShowNoteInput(!showNoteInput)}
                    />
                    <ActionButton
                      label="Keep"
                      description="Mark this bookmark as worth keeping."
                      shortcut="K"
                      color="green"
                      icon={
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      }
                      onClick={() => handleReview('keep')}
                    />
                  </div>
                  <p className="text-center text-[10px] text-gray-600 mt-3">
                    Use left and right arrows for Previous and Next.
                  </p>
                  <p className="text-center text-[10px] text-gray-600">
                    Press <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">K</kbd> to keep, <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">S</kbd> to skip, <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">D</kbd> to delete, <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">N</kbd> for notes, <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">R</kbd> to rename, and <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500">O</kbd> to open.
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
  description,
  shortcut,
  color,
  icon,
  onClick,
}: {
  label: string
  description: string
  shortcut: string
  color: 'red' | 'green' | 'gray' | 'indigo'
  icon: React.ReactNode
  onClick: () => void
}) {
  const colorMap = {
    red: 'hover:border-red-500 hover:bg-red-900/20 group-hover:text-red-400',
    green: 'hover:border-emerald-500 hover:bg-emerald-900/20 group-hover:text-emerald-400',
    gray: 'hover:border-gray-500 hover:bg-gray-700/30 group-hover:text-gray-300',
    indigo: 'hover:border-indigo-500 hover:bg-indigo-900/20 group-hover:text-indigo-400',
  }
  const iconColorMap = {
    red: 'group-hover:text-red-400',
    green: 'group-hover:text-emerald-400',
    gray: 'group-hover:text-gray-300',
    indigo: 'group-hover:text-indigo-400',
  }

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={cn(
          'w-14 h-14 rounded-2xl bg-gray-800 border-2 border-gray-700 flex items-center justify-center transition-all',
          colorMap[color]
        )}
        aria-label={`${label}. ${description} Shortcut ${shortcut}.`}
      >
        <svg className={cn('w-5 h-5 text-gray-400 transition-colors', iconColorMap[color])} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icon}
        </svg>
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-40 -translate-x-1/2 rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-2 text-center opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        <p className="text-[11px] font-medium text-gray-100">
          {label} <span className="text-gray-500">({shortcut})</span>
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-400">{description}</p>
      </div>
    </div>
  )
}
