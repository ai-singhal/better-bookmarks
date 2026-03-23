import { useState, useEffect, useCallback } from 'react'
import { SearchBar } from './components/SearchBar'
import { RecentBookmarks } from './components/RecentBookmarks'
import { QuickActions } from './components/QuickActions'
import type { BookmarkWithMetadata } from '../shared/types'
import { countBookmarks, resolveBookmarkFolders } from '../shared/chromeApi'
import { loadIndex, search as semanticSearch } from '../lib/localSearchEngine'

export function Popup() {
  const [bookmarkCount, setBookmarkCount] = useState(0)
  const [searchResults, setSearchResults] = useState<BookmarkWithMetadata[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [recentBookmarks, setRecentBookmarks] = useState<BookmarkWithMetadata[]>([])
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map())
  const [hasSemanticIndex, setHasSemanticIndex] = useState(false)

  useEffect(() => {
    loadIndex().then(setHasSemanticIndex).catch(() => setHasSemanticIndex(false))

    chrome.bookmarks.getTree().then((tree) => {
      setBookmarkCount(countBookmarks(tree as BookmarkWithMetadata[]))
    })

    // Get more recent bookmarks for scrolling
    chrome.bookmarks.getRecent(20).then(async (recent) => {
      const bookmarks = recent.map((b) => ({
        id: b.id,
        parentId: b.parentId,
        title: b.title,
        url: b.url,
        dateAdded: b.dateAdded,
      }))
      setRecentBookmarks(bookmarks)

      // Resolve folder names
      const folders = await resolveBookmarkFolders(bookmarks)
      setFolderNames(folders)
    })
  }, [])

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      let bookmarks: BookmarkWithMetadata[] = []

      if (hasSemanticIndex || (await loadIndex())) {
        bookmarks = semanticSearch(query, 15).results.map((result) => result.bookmark)
        setHasSemanticIndex(true)
      }

      if (bookmarks.length === 0) {
        const results = await chrome.bookmarks.search(query)
        bookmarks = results.slice(0, 15).map((b) => ({
          id: b.id,
          parentId: b.parentId,
          title: b.title,
          url: b.url,
          dateAdded: b.dateAdded,
        }))
      }

      setSearchResults(bookmarks)

      // Resolve folder names for results
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
  }, [hasSemanticIndex])

  const openDashboard = () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/dashboard/index.html'),
    })
    window.close()
  }

  const displayBookmarks = searchResults.length > 0 ? searchResults : recentBookmarks

  return (
    <div className="w-[380px] h-[500px] bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">
              B
            </div>
            <h1 className="text-base font-semibold">Better Bookmarks</h1>
          </div>
          <span className="text-xs text-gray-500">
            {bookmarkCount} bookmarks
          </span>
        </div>
        <SearchBar onSearch={handleSearch} isSearching={isSearching} />
      </div>

      {/* Results / Recent — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          {searchResults.length > 0 ? 'Search Results' : 'Recent Bookmarks'}
        </h2>
        <RecentBookmarks bookmarks={displayBookmarks} folderNames={folderNames} />
      </div>

      {/* Quick Actions */}
      <QuickActions onOpenDashboard={openDashboard} />
    </div>
  )
}
