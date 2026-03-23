import { useState } from 'react'
import type { BookmarkWithMetadata } from '../../shared/types'
import { flattenBookmarks, getBookmarkTree } from '../../shared/chromeApi'
import { cn, getDomain, getFaviconUrl } from '../../shared/utils'
import { clusterBookmarks, ensureIndex, type BookmarkCluster } from '../../lib/localSearchEngine'
import { FolderPicker } from '../components/FolderPicker'

interface LocalSuggestion {
  id: string
  bookmark: BookmarkWithMetadata
  currentFolderPath: string
  currentFolderId: string
  suggestedFolderPath: string
  suggestedFolderId: string
  reason: string
  confidence: number
}

interface FolderInfo {
  id: string
  title: string
  path: string
  bookmarks: BookmarkWithMetadata[]
  domains: Map<string, number>
}

export function Organization() {
  const [suggestions, setSuggestions] = useState<LocalSuggestion[]>([])
  const [clusters, setClusters] = useState<BookmarkCluster[]>([])
  const [clusterBookmarkMap, setClusterBookmarkMap] = useState<Map<string, BookmarkWithMetadata>>(new Map())
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasAnalyzed, setHasAnalyzed] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [customMoveTarget, setCustomMoveTarget] = useState<LocalSuggestion | null>(null)
  const [emptyFolders, setEmptyFolders] = useState<{ id: string; path: string }[]>([])
  const [duplicates, setDuplicates] = useState<{ url: string; title: string; folders: string[] }[]>([])

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    setHasAnalyzed(true)
    try {
      const tree = await getBookmarkTree()
      const flatBookmarks = flattenBookmarks(tree)
      setClusterBookmarkMap(new Map(flatBookmarks.map((bookmark) => [bookmark.id, bookmark])))
      await ensureIndex(flatBookmarks)
      setClusters(clusterBookmarks().filter((cluster) => cluster.size > 1).slice(0, 12))

      const folderMap = new Map<string, FolderInfo>()
      const allBookmarks: Array<{ bookmark: BookmarkWithMetadata; folderId: string; folderPath: string }> = []
      const urlMap = new Map<string, { title: string; folders: string[] }>()
      const emptyList: { id: string; path: string }[] = []

      // Walk the tree and collect folder info
      function walkTree(nodes: BookmarkWithMetadata[], path: string) {
        for (const node of nodes) {
          if (!node.url && node.children !== undefined) {
            const folderPath = path ? `${path} / ${node.title}` : node.title
            const info: FolderInfo = {
              id: node.id,
              title: node.title,
              path: folderPath,
              bookmarks: [],
              domains: new Map(),
            }

            // Collect bookmarks in this folder
            for (const child of node.children) {
              if (child.url) {
                info.bookmarks.push(child)
                const domain = getDomain(child.url)
                info.domains.set(domain, (info.domains.get(domain) || 0) + 1)
                allBookmarks.push({ bookmark: child, folderId: node.id, folderPath })

                // Track duplicates
                if (urlMap.has(child.url)) {
                  urlMap.get(child.url)!.folders.push(folderPath)
                } else {
                  urlMap.set(child.url, { title: child.title, folders: [folderPath] })
                }
              }
            }

            folderMap.set(node.id, info)

            if (node.children.length === 0) {
              emptyList.push({ id: node.id, path: folderPath })
            }

            walkTree(node.children, folderPath)
          }
        }
      }

      walkTree(tree[0]?.children || [], '')

      // Find suggestions
      const newSuggestions: LocalSuggestion[] = []
      let suggestionId = 0

      // Strategy 1: Find bookmarks whose domain is dominant in another folder
      for (const { bookmark, folderId, folderPath } of allBookmarks) {
        if (!bookmark.url) continue
        const domain = getDomain(bookmark.url)
        const currentFolder = folderMap.get(folderId)
        if (!currentFolder) continue

        // How many bookmarks in this folder share the same domain?
        const domainCountInCurrent = currentFolder.domains.get(domain) || 0
        const totalInCurrent = currentFolder.bookmarks.length

        // Check other folders for better domain fit
        let bestFolder: FolderInfo | null = null
        let bestDomainRatio = 0

        for (const [otherId, otherFolder] of folderMap) {
          if (otherId === folderId) continue
          const otherDomainCount = otherFolder.domains.get(domain) || 0
          if (otherDomainCount === 0) continue
          const otherRatio = otherDomainCount / otherFolder.bookmarks.length

          if (otherRatio > bestDomainRatio && otherDomainCount >= 2) {
            bestDomainRatio = otherRatio
            bestFolder = otherFolder
          }
        }

        // Only suggest if this bookmark's domain is rare in current folder but common in another
        const currentRatio = domainCountInCurrent / totalInCurrent
        if (bestFolder && bestDomainRatio > 0.3 && currentRatio < 0.2 && domainCountInCurrent <= 1) {
          newSuggestions.push({
            id: String(suggestionId++),
            bookmark,
            currentFolderPath: folderPath,
            currentFolderId: folderId,
            suggestedFolderPath: bestFolder.path,
            suggestedFolderId: bestFolder.id,
            reason: `This ${domain} link is the only one in "${currentFolder.title}", but "${bestFolder.title}" already has ${bestFolder.domains.get(domain)} links from ${domain}`,
            confidence: Math.min(bestDomainRatio, 0.95),
          })
        }
      }

      // Strategy 2: Find bookmarks whose title/domain matches another folder's name
      for (const { bookmark, folderId, folderPath } of allBookmarks) {
        if (!bookmark.url) continue
        // Already suggested?
        if (newSuggestions.some((s) => s.bookmark.id === bookmark.id)) continue

        const domain = getDomain(bookmark.url).replace('www.', '').split('.')[0].toLowerCase()
        const titleLower = bookmark.title.toLowerCase()

        for (const [otherId, otherFolder] of folderMap) {
          if (otherId === folderId) continue
          const folderNameLower = otherFolder.title.toLowerCase()
          if (!folderNameLower) continue

          // Check if domain or title strongly matches another folder name
          const domainMatchesFolder = folderNameLower.includes(domain) || domain.includes(folderNameLower)
          const titleMatchesFolder =
            folderNameLower.length > 3 &&
            (titleLower.includes(folderNameLower) || folderNameLower.includes(titleLower.slice(0, 15)))

          if ((domainMatchesFolder || titleMatchesFolder) && folderNameLower !== getDomain(bookmark.url)) {
            const currentFolder = folderMap.get(folderId)
            const currentFolderName = currentFolder?.title.toLowerCase() || ''
            // Don't suggest if the current folder also matches
            if (currentFolderName.includes(domain) || domain.includes(currentFolderName)) continue

            newSuggestions.push({
              id: String(suggestionId++),
              bookmark,
              currentFolderPath: folderPath,
              currentFolderId: folderId,
              suggestedFolderPath: otherFolder.path,
              suggestedFolderId: otherFolder.id,
              reason: domainMatchesFolder
                ? `"${domain}" matches the folder "${otherFolder.title}"`
                : `Bookmark title matches the folder "${otherFolder.title}"`,
              confidence: domainMatchesFolder ? 0.7 : 0.5,
            })
            break
          }
        }
      }

      // Find duplicates
      const dupes = [...urlMap.entries()]
        .filter(([, info]) => info.folders.length > 1)
        .map(([url, info]) => ({ url, title: info.title, folders: info.folders }))

      // Sort suggestions by confidence
      newSuggestions.sort((a, b) => b.confidence - a.confidence)

      setSuggestions(newSuggestions.slice(0, 50))
      setEmptyFolders(emptyList)
      setDuplicates(dupes)
    } catch (err) {
      console.error('Analysis failed:', err)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleAccept = async (suggestion: LocalSuggestion) => {
    setMovingId(suggestion.id)
    try {
      await chrome.bookmarks.move(suggestion.bookmark.id, { parentId: suggestion.suggestedFolderId })
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id))
    } catch (err) {
      console.error('Move failed:', err)
    } finally {
      setMovingId(null)
    }
  }

  const handleDismiss = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id))
  }

  const handleDeleteEmptyFolder = async (folderId: string) => {
    try {
      await chrome.bookmarks.removeTree(folderId)
      setEmptyFolders((prev) => prev.filter((f) => f.id !== folderId))
    } catch (err) {
      console.error('Delete folder failed:', err)
    }
  }

  const handleCustomMove = async (suggestion: LocalSuggestion, targetFolderId: string) => {
    setMovingId(suggestion.id)
    try {
      await chrome.bookmarks.move(suggestion.bookmark.id, { parentId: targetFolderId })
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id))
    } catch (err) {
      console.error('Move failed:', err)
    } finally {
      setMovingId(null)
      setCustomMoveTarget(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Organize</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Find misplaced bookmarks, duplicates, and empty folders
            </p>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isAnalyzing ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyzing...
              </span>
            ) : hasAnalyzed ? (
              'Re-analyze'
            ) : (
              'Analyze Bookmarks'
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!hasAnalyzed ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg className="w-16 h-16 text-gray-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-gray-500 text-sm">Click "Analyze Bookmarks" to find organization issues</p>
            <p className="text-gray-600 text-xs mt-1">
              Detects misplaced bookmarks, duplicate URLs, and empty folders
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            {hasAnalyzed && !isAnalyzing && (
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-lg bg-gray-900/50 border border-gray-800 text-center">
                  <p className="text-2xl font-semibold text-indigo-400">{suggestions.length}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Misplaced</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-gray-900/50 border border-gray-800 text-center">
                  <p className="text-2xl font-semibold text-emerald-400">{clusters.length}</p>
                  <p className="text-xs text-gray-500 mt-0.5">AI Clusters</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-gray-900/50 border border-gray-800 text-center">
                  <p className="text-2xl font-semibold text-amber-400">{duplicates.length}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Duplicates</p>
                </div>
                <div className="flex-1 p-3 rounded-lg bg-gray-900/50 border border-gray-800 text-center">
                  <p className="text-2xl font-semibold text-gray-400">{emptyFolders.length}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Empty Folders</p>
                </div>
              </div>
            )}

            {/* AI Clusters */}
            {clusters.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  AI Topic Clusters
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
                      <div
                        key={cluster.id}
                        className="p-4 rounded-lg bg-gray-900/50 border border-gray-800"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-200">{cluster.label}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {cluster.size} related bookmarks inferred from page vectors
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
                            <div
                              key={bookmark.id}
                              className="flex items-center gap-2 text-xs text-gray-400"
                            >
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

            {/* Misplaced Bookmarks */}
            {suggestions.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Misplaced Bookmarks
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({suggestions.length})
                  </span>
                </h3>
                <div className="space-y-2">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="p-4 rounded-lg bg-gray-900/50 border border-gray-800"
                    >
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
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full',
                            suggestion.confidence > 0.7 ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'
                          )}>
                            {Math.round(suggestion.confidence * 100)}%
                          </span>
                          <button
                            onClick={() => handleAccept(suggestion)}
                            disabled={movingId === suggestion.id}
                            className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white rounded-md transition-colors"
                          >
                            {movingId === suggestion.id ? '...' : 'Move'}
                          </button>
                          <button
                            onClick={() => setCustomMoveTarget(suggestion)}
                            className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md hover:bg-gray-800 transition-colors"
                            title="Choose a different folder"
                          >
                            Other
                          </button>
                          <button
                            onClick={() => handleDismiss(suggestion.id)}
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

            {/* Duplicates */}
            {duplicates.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Duplicate Bookmarks
                  <span className="text-xs text-gray-500 font-normal ml-2">
                    ({duplicates.length})
                  </span>
                </h3>
                <div className="space-y-2">
                  {duplicates.slice(0, 20).map((dupe, i) => (
                    <div key={i} className="p-3 rounded-lg bg-gray-900/50 border border-amber-900/30">
                      <p className="text-sm text-gray-200 truncate">{dupe.title || dupe.url}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {dupe.folders.map((folder, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80">
                            {folder}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Empty Folders */}
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

            {/* All clean */}
            {suggestions.length === 0 && duplicates.length === 0 && emptyFolders.length === 0 && !isAnalyzing && (
              <div className="text-center py-12">
                <p className="text-lg text-gray-300">Your bookmarks look well organized!</p>
                <p className="text-sm text-gray-500 mt-1">No misplaced bookmarks, duplicates, or empty folders found.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom move folder picker */}
      {customMoveTarget && (
        <FolderPicker
          currentFolderId={customMoveTarget.currentFolderId}
          onSelect={(folderId) => handleCustomMove(customMoveTarget, folderId)}
          onClose={() => setCustomMoveTarget(null)}
        />
      )}
    </div>
  )
}
