import { useState, useCallback, useEffect } from 'react'
import type { BookmarkWithMetadata } from '../../shared/types'
import { resolveBookmarkFolders } from '../../shared/chromeApi'
import { truncateUrl, formatRelativeDate, getFaviconUrl } from '../../shared/utils'

export function SemanticSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BookmarkWithMetadata[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map())

  // Load recent bookmarks as default view
  const [recentBookmarks, setRecentBookmarks] = useState<BookmarkWithMetadata[]>([])

  useEffect(() => {
    chrome.bookmarks.getRecent(30).then(async (recent) => {
      const bookmarks = recent.map((b) => ({
        id: b.id,
        parentId: b.parentId,
        title: b.title,
        url: b.url,
        dateAdded: b.dateAdded,
      }))
      setRecentBookmarks(bookmarks)
      const folders = await resolveBookmarkFolders(bookmarks)
      setFolderNames(folders)
    })
  }, [])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setHasSearched(true)
    try {
      const chromeResults = await chrome.bookmarks.search(query)
      const bookmarks = chromeResults.map((b) => ({
        id: b.id,
        parentId: b.parentId,
        title: b.title,
        url: b.url,
        dateAdded: b.dateAdded,
      }))
      setResults(bookmarks)

      const folders = await resolveBookmarkFolders(bookmarks)
      setFolderNames((prev) => {
        const merged = new Map(prev)
        folders.forEach((v, k) => merged.set(k, v))
        return merged
      })
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setIsSearching(false)
    }
  }, [query])

  const displayBookmarks = hasSearched ? results : recentBookmarks

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800">
        <h2 className="text-lg font-semibold">AI Search</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Search your bookmarks
        </p>

        {/* Search Input */}
        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
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
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Try: 'machine learning tutorials' or 'recipes I saved last month'"
              className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching || !query.trim()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {hasSearched && results.length === 0 && !isSearching && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">No results found</p>
          </div>
        )}

        {displayBookmarks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">
              {hasSearched
                ? `${results.length} result${results.length !== 1 ? 's' : ''} found`
                : 'Recently added'}
            </p>
            {displayBookmarks.map((bookmark) => {
              const folderName = bookmark.parentId
                ? folderNames.get(bookmark.parentId) || ''
                : ''

              return (
                <button
                  key={bookmark.id}
                  onClick={() => {
                    if (bookmark.url) chrome.tabs.create({ url: bookmark.url })
                  }}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-lg bg-gray-900/50 hover:bg-gray-800/70 border border-gray-800 hover:border-gray-700 transition-colors text-left group"
                >
                  <img
                    src={bookmark.url ? getFaviconUrl(bookmark.url) : ''}
                    alt=""
                    className="w-5 h-5 rounded flex-shrink-0 mt-0.5"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200 truncate group-hover:text-white">
                      {bookmark.title || 'Untitled'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {folderName && (
                        <>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            {folderName}
                          </span>
                          <span className="text-gray-600 text-xs">·</span>
                        </>
                      )}
                      <p className="text-xs text-gray-500 truncate">
                        {bookmark.url ? truncateUrl(bookmark.url, 50) : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-600 flex-shrink-0 mt-0.5">
                    {formatRelativeDate(bookmark.dateAdded)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!hasSearched && displayBookmarks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg
              className="w-16 h-16 text-gray-700 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <p className="text-gray-500 text-sm">
              Search your bookmarks using natural language
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
