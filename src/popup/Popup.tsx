import { useState, useEffect, useCallback, useRef } from 'react'
import { SearchBar } from './components/SearchBar'
import { RecentBookmarks } from './components/RecentBookmarks'
import { QuickActions } from './components/QuickActions'
import { AIPanel } from './components/AIPanel'
import type { BookmarkWithMetadata } from '../shared/types'
import { countBookmarks, resolveBookmarkFolders } from '../shared/chromeApi'
import { loadIndex, search as semanticSearch } from '../lib/localSearchEngine'
import { BrandLogo } from '../shared/components/BrandLogo'

type Tab = 'bookmarks' | 'ai'

export function Popup() {
  const [activeTab, setActiveTab] = useState<Tab>('bookmarks')
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

  const indexLoadedRef = useRef(false)

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      let bookmarks: BookmarkWithMetadata[] = []

      // Only attempt loadIndex once per popup session
      if (!indexLoadedRef.current && !hasSemanticIndex) {
        const loaded = await loadIndex()
        indexLoadedRef.current = true
        if (loaded) setHasSemanticIndex(true)
      }

      if (hasSemanticIndex || indexLoadedRef.current) {
        bookmarks = semanticSearch(query, 15).results.map((result) => result.bookmark)
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
      <div className="px-4 pt-3 pb-0 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <BrandLogo className="w-6 h-6 flex-shrink-0" title="" />
            <h1 className="text-sm font-semibold">Better Bookmarks</h1>
          </div>
          <span className="text-xs text-gray-500">
            {bookmarkCount} bookmarks
          </span>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab('bookmarks')}
            className={`flex-1 pb-2 text-xs font-medium text-center border-b-2 transition-colors ${
              activeTab === 'bookmarks'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              Bookmarks
            </span>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 pb-2 text-xs font-medium text-center border-b-2 transition-colors ${
              activeTab === 'ai'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              AI Assistant
            </span>
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'bookmarks' ? (
        <>
          {/* Search bar */}
          <div className="px-4 pt-3 pb-2 flex-shrink-0">
            <SearchBar onSearch={handleSearch} isSearching={isSearching} />
          </div>

          {/* Results / Recent — scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              {searchResults.length > 0 ? 'Search Results' : 'Recent Bookmarks'}
            </h2>
            <RecentBookmarks bookmarks={displayBookmarks} folderNames={folderNames} />
          </div>

          {/* Quick Actions */}
          <QuickActions onOpenDashboard={openDashboard} />
        </>
      ) : (
        <AIPanel />
      )}
    </div>
  )
}
