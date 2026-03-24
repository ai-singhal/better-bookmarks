import { useEffect, useState } from 'react'
import { createBookmark } from '../../shared/chromeApi'
import { cn, formatRelativeDate, getFaviconUrl, truncateUrl } from '../../shared/utils'
import {
  analyzeOrganization,
  type BookmarkMoveSuggestion,
  type DuplicateBookmarkInfo,
  type EmptyFolderInfo,
  type HistoryBookmarkSuggestion,
  type ReorganizationRecommendation,
} from '../../lib/organizationAnalysis'
import { type BookmarkCluster } from '../../lib/localSearchEngine'
import type { BookmarkWithMetadata } from '../../shared/types'
import { FolderPicker } from '../components/FolderPicker'

const TIMEFRAME_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
]

const ORGANIZATION_ANALYSIS_CACHE_KEY = 'organization_analysis_cache_v1'

interface StoredOrganizationAnalysis {
  version: 1
  timeframeDays: number
  lastAnalyzedAt: number
  historySitesAnalyzed: number
  totalBookmarks: number
  clusters: BookmarkCluster[]
  clusterBookmarkEntries: Array<[string, BookmarkWithMetadata]>
  moveSuggestions: BookmarkMoveSuggestion[]
  historySuggestions: HistoryBookmarkSuggestion[]
  recommendations: ReorganizationRecommendation[]
  emptyFolders: EmptyFolderInfo[]
  duplicates: DuplicateBookmarkInfo[]
}

export function Organization() {
  const [timeframeDays, setTimeframeDays] = useState(30)
  const [analysisTimeframeDays, setAnalysisTimeframeDays] = useState<number | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasAnalyzed, setHasAnalyzed] = useState(false)
  const [cacheHydrated, setCacheHydrated] = useState(false)
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<number | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [historySitesAnalyzed, setHistorySitesAnalyzed] = useState(0)
  const [totalBookmarks, setTotalBookmarks] = useState(0)
  const [clusters, setClusters] = useState<BookmarkCluster[]>([])
  const [clusterBookmarkMap, setClusterBookmarkMap] = useState<Map<string, BookmarkWithMetadata>>(new Map())
  const [moveSuggestions, setMoveSuggestions] = useState<BookmarkMoveSuggestion[]>([])
  const [historySuggestions, setHistorySuggestions] = useState<HistoryBookmarkSuggestion[]>([])
  const [recommendations, setRecommendations] = useState<ReorganizationRecommendation[]>([])
  const [emptyFolders, setEmptyFolders] = useState<EmptyFolderInfo[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateBookmarkInfo[]>([])
  const [customMoveTarget, setCustomMoveTarget] = useState<BookmarkMoveSuggestion | null>(null)
  const [customHistoryTarget, setCustomHistoryTarget] = useState<HistoryBookmarkSuggestion | null>(null)

  useEffect(() => {
    let cancelled = false

    chrome.storage.local.get(ORGANIZATION_ANALYSIS_CACHE_KEY)
      .then((data) => {
        if (cancelled) return

        const cached = data[ORGANIZATION_ANALYSIS_CACHE_KEY] as StoredOrganizationAnalysis | undefined
        if (!cached || cached.version !== 1) return

        setTimeframeDays(cached.timeframeDays)
        setAnalysisTimeframeDays(cached.timeframeDays)
        setLastAnalyzedAt(cached.lastAnalyzedAt)
        setHistorySitesAnalyzed(cached.historySitesAnalyzed)
        setTotalBookmarks(cached.totalBookmarks)
        setClusters(cached.clusters || [])
        setClusterBookmarkMap(new Map(cached.clusterBookmarkEntries || []))
        setMoveSuggestions(cached.moveSuggestions || [])
        setHistorySuggestions(cached.historySuggestions || [])
        setRecommendations(cached.recommendations || [])
        setEmptyFolders(cached.emptyFolders || [])
        setDuplicates(cached.duplicates || [])
        setHasAnalyzed(true)
      })
      .catch((err) => {
        console.error('Failed to restore organization analysis cache:', err)
      })
      .finally(() => {
        if (!cancelled) {
          setCacheHydrated(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!cacheHydrated || !hasAnalyzed || isAnalyzing || analysisTimeframeDays === null) return

    const payload: StoredOrganizationAnalysis = {
      version: 1,
      timeframeDays: analysisTimeframeDays,
      lastAnalyzedAt: lastAnalyzedAt || Date.now(),
      historySitesAnalyzed,
      totalBookmarks,
      clusters,
      clusterBookmarkEntries: Array.from(clusterBookmarkMap.entries()),
      moveSuggestions,
      historySuggestions,
      recommendations,
      emptyFolders,
      duplicates,
    }

    chrome.storage.local.set({
      [ORGANIZATION_ANALYSIS_CACHE_KEY]: payload,
    }).catch((err) => {
      console.error('Failed to persist organization analysis cache:', err)
    })
  }, [
    analysisTimeframeDays,
    cacheHydrated,
    clusterBookmarkMap,
    clusters,
    duplicates,
    emptyFolders,
    hasAnalyzed,
    historySitesAnalyzed,
    historySuggestions,
    isAnalyzing,
    lastAnalyzedAt,
    moveSuggestions,
    recommendations,
    totalBookmarks,
  ])

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    setHasAnalyzed(true)
    try {
      const result = await analyzeOrganization(timeframeDays)
      setAnalysisTimeframeDays(result.timeframeDays)
      setLastAnalyzedAt(Date.now())
      setHistorySitesAnalyzed(result.historySitesAnalyzed)
      setTotalBookmarks(result.totalBookmarks)
      setClusters(result.clusters)
      setClusterBookmarkMap(result.clusterBookmarkMap)
      setMoveSuggestions(result.moveSuggestions)
      setHistorySuggestions(result.historySuggestions)
      setRecommendations(result.recommendations)
      setEmptyFolders(result.emptyFolders)
      setDuplicates(result.duplicates)
    } catch (err) {
      console.error('Analysis failed:', err)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleAcceptMove = async (suggestion: BookmarkMoveSuggestion, targetFolderId = suggestion.suggestedFolderId) => {
    setWorkingId(suggestion.id)
    try {
      await chrome.bookmarks.move(suggestion.bookmark.id, { parentId: targetFolderId })
      setMoveSuggestions((prev) => prev.filter((item) => item.id !== suggestion.id))
    } catch (err) {
      console.error('Move failed:', err)
    } finally {
      setWorkingId(null)
      setCustomMoveTarget(null)
    }
  }

  const handleBookmarkHistorySuggestion = async (
    suggestion: HistoryBookmarkSuggestion,
    folderId = suggestion.suggestedFolderId
  ) => {
    if (!folderId) return

    setWorkingId(suggestion.id)
    try {
      await createBookmark({
        parentId: folderId,
        title: suggestion.title || suggestion.domain,
        url: suggestion.url,
      })
      setHistorySuggestions((prev) => prev.filter((item) => item.id !== suggestion.id))
    } catch (err) {
      console.error('Bookmark create failed:', err)
    } finally {
      setWorkingId(null)
      setCustomHistoryTarget(null)
    }
  }

  const handleDismissMove = (id: string) => {
    setMoveSuggestions((prev) => prev.filter((item) => item.id !== id))
  }

  const handleDismissHistory = (id: string) => {
    setHistorySuggestions((prev) => prev.filter((item) => item.id !== id))
  }

  const handleDeleteEmptyFolder = async (folderId: string) => {
    try {
      await chrome.bookmarks.removeTree(folderId)
      setEmptyFolders((prev) => prev.filter((folder) => folder.id !== folderId))
      setRecommendations((prev) => prev.filter((recommendation) => recommendation.folderId !== folderId))
    } catch (err) {
      console.error('Delete folder failed:', err)
    }
  }

  const recommendationTypeStyles: Record<ReorganizationRecommendation['type'], string> = {
    'rename-folder': 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
    'reorder-folder': 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20',
    'create-folder': 'bg-sky-500/10 text-sky-300 border border-sky-500/20',
    'delete-folder': 'bg-red-500/10 text-red-300 border border-red-500/20',
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Organize</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Match your bookmarks against recent browsing history and get a concrete cleanup plan.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-600 mb-1">
                History window
              </label>
              <select
                value={timeframeDays}
                onChange={(e) => setTimeframeDays(Number(e.target.value))}
                className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                {TIMEFRAME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="self-end px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </span>
              ) : hasAnalyzed ? (
                'Re-analyze'
              ) : (
                'Analyze Structure'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!hasAnalyzed ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg className="w-16 h-16 text-gray-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 6h16M4 12h16M4 18h10m6 0h.01M20 12h.01M20 6h.01" />
            </svg>
            <p className="text-gray-400 text-sm">
              Analyze your bookmarks against Chrome history to surface high-signal suggestions.
            </p>
            <p className="text-gray-600 text-xs mt-1">
              This looks at frequent sites, folder fit, duplicate links, empty folders, and folder structure.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {!isAnalyzing && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <SummaryCard value={historySuggestions.length} label="History Suggestions" tone="sky" />
                  <SummaryCard value={recommendations.length} label="Structure Changes" tone="indigo" />
                  <SummaryCard value={moveSuggestions.length} label="Bookmark Moves" tone="emerald" />
                  <SummaryCard value={duplicates.length} label="Duplicates" tone="amber" />
                  <SummaryCard value={emptyFolders.length} label="Empty Folders" tone="gray" />
                </div>

                <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  <span>{totalBookmarks} bookmarks analyzed</span>
                  <span>{historySitesAnalyzed} history sites scanned</span>
                  <span>window: last {analysisTimeframeDays ?? timeframeDays} days</span>
                  {lastAnalyzedAt && <span>saved {formatRelativeDate(lastAnalyzedAt)}</span>}
                </div>
              </>
            )}

            {historySuggestions.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Suggested Bookmarks From History
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({historySuggestions.length})
                  </span>
                </h3>

                <div className="space-y-2">
                  {historySuggestions.map((suggestion) => (
                    <div key={suggestion.id} className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                      <div className="flex items-start gap-3">
                        <img
                          src={getFaviconUrl(suggestion.url)}
                          alt=""
                          className="w-5 h-5 rounded flex-shrink-0 mt-0.5"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-200 truncate">
                              {suggestion.title || suggestion.domain}
                            </p>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                              {suggestion.visitCount} visits
                            </span>
                          </div>

                          <a
                            href={suggestion.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-gray-500 hover:text-indigo-400 transition-colors mt-1 block truncate"
                          >
                            {truncateUrl(suggestion.url, 70)}
                          </a>

                          <p className="text-xs text-gray-500 mt-1.5">{suggestion.reason}</p>

                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span className="text-[10px] text-gray-600">
                              last visited {formatRelativeDate(suggestion.lastVisitTime)}
                            </span>
                            {suggestion.suggestedFolderPath ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                suggested folder: {suggestion.suggestedFolderPath}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400">
                                no clear folder match yet
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => {
                              chrome.tabs.create({ url: suggestion.url })
                            }}
                            className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md hover:bg-gray-800 transition-colors"
                          >
                            Open
                          </button>
                          {suggestion.suggestedFolderId && (
                            <button
                              onClick={() => handleBookmarkHistorySuggestion(suggestion)}
                              disabled={workingId === suggestion.id}
                              className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white rounded-md transition-colors"
                            >
                              {workingId === suggestion.id ? '...' : 'Bookmark'}
                            </button>
                          )}
                          <button
                            onClick={() => setCustomHistoryTarget(suggestion)}
                            className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md hover:bg-gray-800 transition-colors"
                          >
                            {suggestion.suggestedFolderId ? 'Other' : 'Choose folder'}
                          </button>
                          <button
                            onClick={() => handleDismissHistory(suggestion.id)}
                            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                            title="Dismiss"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {recommendations.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Reorganization Plan
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({recommendations.length})
                  </span>
                </h3>

                <div className="space-y-2">
                  {recommendations.map((recommendation) => (
                    <div key={recommendation.id} className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-200">{recommendation.title}</p>
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', recommendationTypeStyles[recommendation.type])}>
                              {recommendation.type.replace('-', ' ')}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400">
                              {Math.round(recommendation.confidence * 100)}%
                            </span>
                          </div>

                          <p className="text-xs text-gray-500 mt-1.5">{recommendation.description}</p>

                          <div className="flex flex-wrap gap-2 mt-2">
                            {recommendation.folderPath && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400">
                                {recommendation.folderPath}
                              </span>
                            )}
                            {recommendation.suggestedName && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                suggested name: {recommendation.suggestedName}
                              </span>
                            )}
                            {recommendation.historyVisitCount ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                                {recommendation.historyVisitCount} history signals
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {recommendation.type === 'delete-folder' && recommendation.folderId && (
                          <button
                            onClick={() => handleDeleteEmptyFolder(recommendation.folderId!)}
                            className="px-2.5 py-1 text-xs text-red-300 hover:text-red-200 border border-red-900/40 rounded-md hover:bg-red-900/20 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {moveSuggestions.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Bookmark Moves
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({moveSuggestions.length})
                  </span>
                </h3>

                <div className="space-y-2">
                  {moveSuggestions.map((suggestion) => (
                    <div key={suggestion.id} className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                      <div className="flex items-start gap-3">
                        <img
                          src={suggestion.bookmark.url ? getFaviconUrl(suggestion.bookmark.url) : ''}
                          alt=""
                          className="w-5 h-5 rounded flex-shrink-0 mt-0.5"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200 truncate">
                            {suggestion.bookmark.title || 'Untitled'}
                          </p>
                          <div className="flex items-center gap-1 mt-1 text-xs">
                            <span className="text-gray-500 truncate max-w-[150px]">{suggestion.currentFolderPath}</span>
                            <svg className="w-3 h-3 text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            <span className="text-indigo-400 truncate max-w-[150px]">{suggestion.suggestedFolderPath}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{suggestion.reason}</p>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {suggestion.historyVisitCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                              {suggestion.historyVisitCount} visits
                            </span>
                          )}
                          <button
                            onClick={() => handleAcceptMove(suggestion)}
                            disabled={workingId === suggestion.id}
                            className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white rounded-md transition-colors"
                          >
                            {workingId === suggestion.id ? '...' : 'Move'}
                          </button>
                          <button
                            onClick={() => setCustomMoveTarget(suggestion)}
                            className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md hover:bg-gray-800 transition-colors"
                          >
                            Other
                          </button>
                          <button
                            onClick={() => handleDismissMove(suggestion.id)}
                            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                            title="Dismiss"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {clusters.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Topic Clusters
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({clusters.length})
                  </span>
                </h3>
                <div className="grid gap-3 xl:grid-cols-2">
                  {clusters.map((cluster) => {
                    const sampleBookmarks = cluster.bookmarkIds
                      .map((bookmarkId) => clusterBookmarkMap.get(bookmarkId))
                      .filter((bookmark): bookmark is BookmarkWithMetadata => Boolean(bookmark))
                      .slice(0, 4)

                    return (
                      <div key={cluster.id} className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-200">{cluster.label}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {cluster.size} related bookmarks inferred from local content and tags
                            </p>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {cluster.keywords.slice(0, 3).map((keyword) => (
                              <span
                                key={keyword}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                              >
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3 space-y-1.5">
                          {sampleBookmarks.map((bookmark) => (
                            <div key={bookmark.id} className="flex items-center gap-2 text-xs text-gray-400">
                              <img
                                src={bookmark.url ? getFaviconUrl(bookmark.url) : ''}
                                alt=""
                                className="w-3.5 h-3.5 rounded flex-shrink-0"
                                onError={(e) => {
                                  ;(e.target as HTMLImageElement).style.display = 'none'
                                }}
                              />
                              <span className="truncate">{bookmark.title || bookmark.url}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {duplicates.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Duplicate Bookmarks
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({duplicates.length})
                  </span>
                </h3>
                <div className="space-y-2">
                  {duplicates.slice(0, 20).map((dupe, index) => (
                    <div key={index} className="p-3 rounded-lg bg-gray-900/50 border border-amber-900/30">
                      <p className="text-sm text-gray-200 truncate">{dupe.title || dupe.url}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {dupe.folders.map((folder, folderIndex) => (
                          <span key={folderIndex} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80">
                            {folder}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {emptyFolders.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Empty Folders
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({emptyFolders.length})
                  </span>
                </h3>
                <div className="space-y-1">
                  {emptyFolders.map((folder) => (
                    <div key={folder.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/50 border border-gray-800">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        <span className="text-sm text-gray-400">{folder.path}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteEmptyFolder(folder.id)}
                        className="px-2.5 py-1 text-xs text-red-400 hover:text-red-300 border border-red-900/30 rounded-md hover:bg-red-900/20 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {historySuggestions.length === 0 &&
              recommendations.length === 0 &&
              moveSuggestions.length === 0 &&
              duplicates.length === 0 &&
              emptyFolders.length === 0 &&
              !isAnalyzing && (
                <div className="text-center py-12">
                  <p className="text-lg text-gray-300">Your bookmark structure looks healthy.</p>
                  <p className="text-sm text-gray-500 mt-1">
                    This timeframe did not surface strong bookmark, folder, or history-driven changes.
                  </p>
                </div>
              )}
          </div>
        )}
      </div>

      {customMoveTarget && (
        <FolderPicker
          currentFolderId={customMoveTarget.currentFolderId}
          onSelect={(folderId) => handleAcceptMove(customMoveTarget, folderId)}
          onClose={() => setCustomMoveTarget(null)}
        />
      )}

      {customHistoryTarget && (
        <FolderPicker
          onSelect={(folderId) => handleBookmarkHistorySuggestion(customHistoryTarget, folderId)}
          onClose={() => setCustomHistoryTarget(null)}
        />
      )}
    </div>
  )
}

function SummaryCard({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone: 'sky' | 'indigo' | 'emerald' | 'amber' | 'gray'
}) {
  const toneMap = {
    sky: 'text-sky-400',
    indigo: 'text-indigo-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    gray: 'text-gray-400',
  }

  return (
    <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800 text-center">
      <p className={cn('text-2xl font-semibold', toneMap[tone])}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
