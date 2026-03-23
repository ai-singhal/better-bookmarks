import { useState, useEffect } from 'react'
import { useBookmarkStore } from '../../shared/store'
import { resolveBookmarkFolders } from '../../shared/chromeApi'
import { cn, truncateUrl, getFaviconUrl, formatRelativeDate } from '../../shared/utils'
import type { BookmarkWithMetadata } from '../../shared/types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const navItems = [
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
      />
    ),
  },
  {
    id: 'search',
    label: 'AI Search',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    ),
  },
  {
    id: 'organize',
    label: 'Organize',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    ),
  },
  {
    id: 'reminders',
    label: 'Reminders',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
    ),
  },
]

export function Sidebar() {
  const activePage = useBookmarkStore((s) => s.activePage)
  const setActivePage = useBookmarkStore((s) => s.setActivePage)
  const [recentBookmarks, setRecentBookmarks] = useState<BookmarkWithMetadata[]>([])
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map())
  const [recentCollapsed, setRecentCollapsed] = useState(true)

  async function loadRecent() {
    // Fetch a large batch and filter to past 30 days
    const recent = await chrome.bookmarks.getRecent(200)
    const cutoff = Date.now() - THIRTY_DAYS_MS
    const bookmarks = recent
      .filter((b) => b.dateAdded && b.dateAdded >= cutoff)
      .map((b) => ({
        id: b.id,
        parentId: b.parentId,
        title: b.title,
        url: b.url,
        dateAdded: b.dateAdded,
      }))
    setRecentBookmarks(bookmarks)
    const folders = await resolveBookmarkFolders(bookmarks)
    setFolderNames(folders)
  }

  useEffect(() => {
    loadRecent()

    const listener = (msg: { type: string }) => {
      if (msg.type === 'BOOKMARK_CREATED' || msg.type === 'BOOKMARK_REMOVED') {
        loadRecent()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  return (
    <aside className="w-60 border-r border-gray-800 flex flex-col bg-gray-950">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">
            B
          </div>
          <div>
            <h1 className="text-sm font-semibold">Better Bookmarks</h1>
            <p className="text-xs text-gray-500">for Chrome</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 space-y-1 flex-shrink-0">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              activePage === item.id
                ? 'bg-indigo-600/15 text-indigo-400'
                : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
            )}
          >
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {item.icon}
            </svg>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Recent Bookmarks — collapsible */}
      <div className="flex-1 min-h-0 flex flex-col border-t border-gray-800">
        <button
          onClick={() => setRecentCollapsed(!recentCollapsed)}
          className="w-full px-5 pt-3 pb-2 flex items-center justify-between flex-shrink-0 hover:bg-gray-800/30 transition-colors"
        >
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Recent
            <span className="ml-1.5 normal-case tracking-normal text-gray-600">
              ({recentBookmarks.length})
            </span>
          </span>
          <svg
            className={cn(
              'w-3.5 h-3.5 text-gray-600 transition-transform',
              recentCollapsed && '-rotate-90'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!recentCollapsed && (
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {recentBookmarks.length === 0 && (
              <p className="text-xs text-gray-600 px-2.5 py-3">
                No bookmarks in the past 30 days
              </p>
            )}
            {recentBookmarks.map((bookmark) => {
              const folderName = bookmark.parentId
                ? folderNames.get(bookmark.parentId) || ''
                : ''

              return (
                <button
                  key={bookmark.id}
                  onClick={() => {
                    if (bookmark.url) chrome.tabs.create({ url: bookmark.url })
                  }}
                  className="w-full flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-gray-800/50 transition-colors text-left group"
                >
                  <img
                    src={bookmark.url ? getFaviconUrl(bookmark.url) : ''}
                    alt=""
                    className="w-3.5 h-3.5 rounded flex-shrink-0 mt-0.5"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-300 truncate group-hover:text-white">
                      {bookmark.title || 'Untitled'}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {folderName && (
                        <span className="text-[10px] text-indigo-400/70 truncate max-w-[80px]">
                          {folderName}
                        </span>
                      )}
                      {folderName && (
                        <span className="text-[10px] text-gray-700">·</span>
                      )}
                      <span className="text-[10px] text-gray-600 truncate">
                        {folderName
                          ? formatRelativeDate(bookmark.dateAdded)
                          : bookmark.url
                            ? truncateUrl(bookmark.url, 22)
                            : ''}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-800 flex-shrink-0">
        <p className="text-xs text-gray-600">Better Bookmarks v1.0</p>
      </div>
    </aside>
  )
}
