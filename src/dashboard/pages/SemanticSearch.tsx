import { useCallback, useEffect, useState } from 'react'
import type {
  BookmarkInsight,
  BookmarkWithMetadata,
} from '../../shared/types'
import {
  flattenBookmarks,
  getBookmarkTree,
  resolveBookmarkFolders,
} from '../../shared/chromeApi'
import {
  clusterBookmarks,
  ensureIndex,
  getIndexStats,
  getIndexedBookmarks,
  indexBookmarks,
  search as semanticSearch,
  type BookmarkCluster,
  type IndexingProgress,
  type SearchResult,
} from '../../lib/localSearchEngine'
import {
  formatRelativeDate,
  getFaviconUrl,
  truncateUrl,
} from '../../shared/utils'
import { BookmarkInsightEditor } from '../components/BookmarkInsightEditor'

function buildRecentResults(bookmarks: BookmarkWithMetadata[]): SearchResult[] {
  const indexedById = new Map(
    getIndexedBookmarks().map((bookmark) => [bookmark.chromeId, bookmark])
  )

  return bookmarks.map((bookmark) => {
    const indexed = indexedById.get(bookmark.id)
    return {
      bookmark,
      score: bookmark.dateAdded || 0,
      matchReasons: ['Recent bookmark'],
      highlights: [],
      excerpt:
        bookmark.insight?.reason ||
        bookmark.insight?.summary ||
        indexed?.summary ||
        indexed?.pageDescription ||
        '',
      clusterLabel: indexed?.clusterLabel,
    }
  })
}

function patchInsightOnResults(
  items: SearchResult[],
  bookmarkId: string,
  insight: BookmarkInsight
): SearchResult[] {
  return items.map((item) => {
    if (item.bookmark.id !== bookmarkId) return item

    return {
      ...item,
      bookmark: {
        ...item.bookmark,
        insight,
      },
      excerpt: insight.reason || insight.summary || item.excerpt,
    }
  })
}

export function SemanticSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [recentResults, setRecentResults] = useState<SearchResult[]>([])
  const [allBookmarks, setAllBookmarks] = useState<BookmarkWithMetadata[]>([])
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map())
  const [clusters, setClusters] = useState<BookmarkCluster[]>([])
  const [indexStats, setIndexStats] = useState(getIndexStats())
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexProgress, setIndexProgress] = useState<IndexingProgress | null>(null)
  const [expandedBookmarkId, setExpandedBookmarkId] = useState<string | null>(null)
  const [querySummary, setQuerySummary] = useState<{
    timeFilterLabel?: string
    intentHints: string[]
  }>({ intentHints: [] })

  const refreshFolderNames = useCallback(async (bookmarks: BookmarkWithMetadata[]) => {
    const folders = await resolveBookmarkFolders(bookmarks)
    setFolderNames((previous) => {
      const merged = new Map(previous)
      folders.forEach((value, key) => merged.set(key, value))
      return merged
    })
  }, [])

  const syncIndex = useCallback(
    async (bookmarks: BookmarkWithMetadata[]) => {
      setIsIndexing(true)
      try {
        await ensureIndex(bookmarks, setIndexProgress)
        setIndexStats(getIndexStats())
        setClusters(clusterBookmarks().filter((cluster) => cluster.size > 1).slice(0, 8))
      } finally {
        setIsIndexing(false)
        setIndexProgress(null)
      }
    },
    []
  )

  const loadBookmarks = useCallback(async () => {
    const tree = await getBookmarkTree()
    const flatBookmarks = flattenBookmarks(tree).sort(
      (a, b) => (b.dateAdded || 0) - (a.dateAdded || 0)
    )

    setAllBookmarks(flatBookmarks)
    await syncIndex(flatBookmarks)

    const recent = flatBookmarks.slice(0, 30)
    setRecentResults(buildRecentResults(recent))
    await refreshFolderNames(recent)
  }, [refreshFolderNames, syncIndex])

  useEffect(() => {
    void loadBookmarks()

    const handleBookmarkMutation = (message: { type: string }) => {
      if (
        message.type === 'BOOKMARK_CREATED' ||
        message.type === 'BOOKMARK_CHANGED' ||
        message.type === 'BOOKMARK_MOVED' ||
        message.type === 'BOOKMARK_REMOVED'
      ) {
        void loadBookmarks()
      }
    }

    chrome.runtime.onMessage.addListener(handleBookmarkMutation)
    return () => chrome.runtime.onMessage.removeListener(handleBookmarkMutation)
  }, [loadBookmarks])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setHasSearched(false)
      setResults([])
      setQuerySummary({ intentHints: [] })
      return
    }

    setIsSearching(true)
    setHasSearched(true)

    try {
      await syncIndex(allBookmarks)
      const { results: searchResults, parsedQuery } = semanticSearch(query, 50)
      setResults(searchResults)
      setQuerySummary({
        timeFilterLabel: parsedQuery.timeFilter?.label,
        intentHints: parsedQuery.intentHints,
      })
      await refreshFolderNames(searchResults.map((result) => result.bookmark))
    } finally {
      setIsSearching(false)
    }
  }, [allBookmarks, query, refreshFolderNames, syncIndex])

  const handleRebuildIndex = useCallback(async () => {
    if (allBookmarks.length === 0) return

    setIsIndexing(true)
    try {
      await indexBookmarks(allBookmarks, setIndexProgress)
      setIndexStats(getIndexStats())
      setClusters(clusterBookmarks().filter((cluster) => cluster.size > 1).slice(0, 8))
      setRecentResults(buildRecentResults(allBookmarks.slice(0, 30)))

      if (query.trim()) {
        const { results: searchResults, parsedQuery } = semanticSearch(query, 50)
        setResults(searchResults)
        setQuerySummary({
          timeFilterLabel: parsedQuery.timeFilter?.label,
          intentHints: parsedQuery.intentHints,
        })
      }
    } finally {
      setIsIndexing(false)
      setIndexProgress(null)
    }
  }, [allBookmarks, query])

  const handleInsightSaved = useCallback((bookmarkId: string, insight: BookmarkInsight) => {
    setRecentResults((previous) => patchInsightOnResults(previous, bookmarkId, insight))
    setResults((previous) => patchInsightOnResults(previous, bookmarkId, insight))
    setAllBookmarks((previous) =>
      previous.map((bookmark) =>
        bookmark.id === bookmarkId
          ? { ...bookmark, insight }
          : bookmark
      )
    )
  }, [])

  const displayResults = hasSearched ? results : recentResults

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-gray-800 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold">AI Search</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Parsed pages, vectorized bookmark context, reminder-aware search, and topic clustering.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-gray-400">
            <span className="rounded-full border border-gray-800 bg-gray-900/80 px-3 py-1.5">
              {indexStats.totalDocuments} indexed
            </span>
            <span className="rounded-full border border-gray-800 bg-gray-900/80 px-3 py-1.5">
              {indexStats.totalTerms} terms
            </span>
            <span className="rounded-full border border-gray-800 bg-gray-900/80 px-3 py-1.5">
              {indexStats.clusters} clusters
            </span>
            <button
              onClick={handleRebuildIndex}
              disabled={isIndexing}
              className="rounded-full border border-gray-700 px-3 py-1.5 text-gray-200 transition-colors hover:border-indigo-500 hover:text-white disabled:border-gray-800 disabled:text-gray-600"
            >
              {isIndexing ? 'Indexing...' : 'Rebuild Index'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
              placeholder="Try: cracked people in ML from last month"
              className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-10 pr-4 py-3 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={isSearching || isIndexing || !query.trim()}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {(querySummary.timeFilterLabel || querySummary.intentHints.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {querySummary.timeFilterLabel && (
              <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-300">
                Time: {querySummary.timeFilterLabel}
              </span>
            )}
            {querySummary.intentHints.map((hint) => (
              <span
                key={hint}
                className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs capitalize text-emerald-300"
              >
                Intent: {hint}
              </span>
            ))}
          </div>
        )}

        {isIndexing && indexProgress && (
          <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/70 p-3">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="capitalize">{indexProgress.phase}</span>
              <span>
                {indexProgress.current} / {Math.max(indexProgress.total, 1)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{
                  width: `${(indexProgress.current / Math.max(indexProgress.total, 1)) * 100}%`,
                }}
              />
            </div>
            {indexProgress.currentUrl && (
              <p className="mt-2 truncate text-xs text-gray-500">
                {truncateUrl(indexProgress.currentUrl, 90)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!hasSearched && clusters.length > 0 && (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-200">Topic Clusters</h3>
              <p className="text-xs text-gray-500">
                Groups inferred from bookmark vectors
              </p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {clusters.slice(0, 6).map((cluster) => (
                <div
                  key={cluster.id}
                  className="rounded-2xl border border-gray-800 bg-gray-900/50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-100">
                        {cluster.label}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {cluster.size} bookmark{cluster.size === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {cluster.keywords.slice(0, 3).map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasSearched && !isSearching && results.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
            <p className="text-sm text-gray-400">No bookmarks matched that query.</p>
            <p className="mt-1 text-xs text-gray-600">
              Try adding a reason/tag to important bookmarks or broaden the time filter.
            </p>
          </div>
        )}

        {displayResults.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">
              {hasSearched
                ? `${results.length} AI-ranked result${results.length === 1 ? '' : 's'}`
                : 'Recent bookmarks'}
            </p>

            {displayResults.map((result) => {
              const bookmark = result.bookmark
              const folderName = bookmark.parentId
                ? folderNames.get(bookmark.parentId) || ''
                : ''
              const isExpanded = expandedBookmarkId === bookmark.id

              return (
                <div
                  key={bookmark.id}
                  className="rounded-2xl border border-gray-800 bg-gray-900/55 p-4"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={bookmark.url ? getFaviconUrl(bookmark.url) : ''}
                      alt=""
                      className="mt-0.5 h-5 w-5 rounded flex-shrink-0"
                      onError={(event) => {
                        ;(event.target as HTMLImageElement).style.display = 'none'
                      }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <button
                            onClick={() => {
                              if (bookmark.url) chrome.tabs.create({ url: bookmark.url })
                            }}
                            className="truncate text-left text-sm font-medium text-gray-100 transition-colors hover:text-white"
                          >
                            {bookmark.title || 'Untitled'}
                          </button>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            {folderName && (
                              <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-indigo-300">
                                {folderName}
                              </span>
                            )}
                            {result.clusterLabel && (
                              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-300">
                                {result.clusterLabel}
                              </span>
                            )}
                            <span>{bookmark.url ? truncateUrl(bookmark.url, 52) : ''}</span>
                            <span>·</span>
                            <span>{formatRelativeDate(bookmark.dateAdded)}</span>
                          </div>

                          {result.excerpt && (
                            <p className="mt-3 text-sm leading-6 text-gray-300">
                              {result.excerpt}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {result.matchReasons.map((reason) => (
                              <span
                                key={`${bookmark.id}-${reason}`}
                                className="rounded-full border border-gray-700 px-2.5 py-1 text-[11px] text-gray-300"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-shrink-0 items-center gap-2">
                          <button
                            onClick={() =>
                              setExpandedBookmarkId((current) =>
                                current === bookmark.id ? null : bookmark.id
                              )
                            }
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-indigo-500 hover:text-white"
                          >
                            {isExpanded ? 'Hide Details' : 'Details'}
                          </button>
                          <button
                            onClick={() => {
                              if (bookmark.url) chrome.tabs.create({ url: bookmark.url })
                            }}
                            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-700"
                          >
                            Open
                          </button>
                        </div>
                      </div>

                      {bookmark.insight?.reminderAt && (
                        <p className="mt-3 text-xs text-amber-300">
                          Reminder set for {new Date(bookmark.insight.reminderAt).toLocaleString()}
                        </p>
                      )}

                      {isExpanded && (
                        <BookmarkInsightEditor
                          bookmark={bookmark}
                          onInsightSaved={(insight) =>
                            handleInsightSaved(bookmark.id, insight)
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!hasSearched && displayResults.length === 0 && !isIndexing && (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
              <p className="text-sm text-gray-400">
                Search understands page content, bookmark reasons, tags, reminders, and time ranges.
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Example: cracked people in ML from last month
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
