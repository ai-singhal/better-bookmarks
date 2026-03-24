import { useCallback, useEffect, useState } from 'react'
import { useBookmarkStore } from '../../shared/store'
import { resolveBookmarkFolders } from '../../shared/chromeApi'
import { cn, truncateUrl, getFaviconUrl, formatRelativeDate } from '../../shared/utils'
import type { BookmarkWithMetadata } from '../../shared/types'
import { BrandLogo } from '../../shared/components/BrandLogo'
import { getDeletedBookmarks, restoreDeletedBookmark, type DeletedBookmarkRecord } from '../../lib/deletedBookmarkService'

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
    id: 'command',
    label: 'AI Chat',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9.5 4.5a3.5 3.5 0 00-3.5 3.5v.5a3 3 0 00-2 2.828V13a3 3 0 003 3h.25a2.75 2.75 0 002.5 2h.5A2.75 2.75 0 0013 16h.5a2.5 2.5 0 002.5-2.5V13h.25a3 3 0 003-3v-1.672A3 3 0 0017 5.5V5a3.5 3.5 0 00-6.362-2.044A3.48 3.48 0 009.5 4.5zm-1 4.25h.5m6.5 0h.5M9 12.5h1m4 0h1M12 4v10"
      />
    ),
  },
  {
    id: 'discover',
    label: 'Discover',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
      />
    ),
  },
  {
    id: 'organization',
    label: 'Organize',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 6h16M4 12h10M4 18h7m11 0h.01M18 12h.01M22 6h.01"
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
  const [deletedBookmarks, setDeletedBookmarks] = useState<DeletedBookmarkRecord[]>([])
  const [folderNames, setFolderNames] = useState<Map<string, string>>(new Map())
  const [recentAddedCollapsed, setRecentAddedCollapsed] = useState(true)
  const [recentDeletedCollapsed, setRecentDeletedCollapsed] = useState(true)
  const [restoringDeletedId, setRestoringDeletedId] = useState<string | null>(null)

  const loadRecent = useCallback(async () => {
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
  }, [])

  const loadDeleted = useCallback(async () => {
    const records = await getDeletedBookmarks()
    setDeletedBookmarks(records)
  }, [])

  const handleRestoreDeletedBookmark = useCallback(async (recordId: string) => {
    setRestoringDeletedId(recordId)
    try {
      await restoreDeletedBookmark(recordId)
      await loadDeleted()
      await loadRecent()
    } catch (err) {
      console.error('Failed to restore deleted bookmark:', err)
    } finally {
      setRestoringDeletedId(null)
    }
  }, [loadDeleted, loadRecent])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRecent()
      void loadDeleted()
    }, 0)

    const listener = (msg: { type: string }) => {
      if (msg.type === 'BOOKMARK_CREATED' || msg.type === 'BOOKMARK_REMOVED') {
        void loadRecent()
        void loadDeleted()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      window.clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [loadDeleted, loadRecent])

  return (
    <aside className="w-60 border-r border-gray-800 flex flex-col bg-gray-950">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <BrandLogo className="w-8 h-8 flex-shrink-0" title="" />
          <div>
            <h1 className="text-sm font-semibold">Better Bookmarks</h1>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <span>for</span>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-label="Chrome logo">
                <path fill="#DB4437" d="M12 12L3.4 12A9 9 0 0 1 20.2 8.2L16 15.5Z" />
                <path fill="#0F9D58" d="M12 12l4 3.5-4.2 7.3A9 9 0 0 1 3.4 12Z" />
                <path fill="#F4B400" d="M12 12l4-3.5h8A9 9 0 0 1 11.8 22.8Z" />
                <circle cx="12" cy="12" r="3.6" fill="#4285F4" />
                <circle cx="12" cy="12" r="1.8" fill="#AECBFA" />
              </svg>
            </div>
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

      {/* Recent activity */}
      <div className="flex-1 min-h-0 flex flex-col border-t border-gray-800">
        <button
          onClick={() => setRecentAddedCollapsed(!recentAddedCollapsed)}
          className="w-full px-5 pt-3 pb-2 flex items-center justify-between flex-shrink-0 hover:bg-gray-800/30 transition-colors"
        >
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Recently Added
            <span className="ml-1.5 normal-case tracking-normal text-gray-600">
              ({recentBookmarks.length})
            </span>
          </span>
          <svg
            className={cn(
              'w-3.5 h-3.5 text-gray-600 transition-transform',
              recentAddedCollapsed && '-rotate-90'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div
          className={cn(
            'grid min-h-0 transition-[grid-template-rows,opacity] duration-300 ease-out',
            recentAddedCollapsed
              ? 'grid-rows-[0fr] opacity-0 pointer-events-none'
              : 'grid-rows-[1fr] opacity-100'
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="h-full overflow-y-auto px-2 pb-2">
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
          </div>
        </div>

        <button
          onClick={() => setRecentDeletedCollapsed(!recentDeletedCollapsed)}
          className="w-full px-5 pt-2 pb-2 flex items-center justify-between flex-shrink-0 hover:bg-gray-800/30 transition-colors border-t border-gray-800"
        >
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Recently Deleted
            <span className="ml-1.5 normal-case tracking-normal text-gray-600">
              ({deletedBookmarks.length})
            </span>
          </span>
          <svg
            className={cn(
              'w-3.5 h-3.5 text-gray-600 transition-transform',
              recentDeletedCollapsed && '-rotate-90'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div
          className={cn(
            'grid min-h-0 transition-[grid-template-rows,opacity] duration-300 ease-out',
            recentDeletedCollapsed
              ? 'grid-rows-[0fr] opacity-0 pointer-events-none'
              : 'grid-rows-[1fr] opacity-100'
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="h-full overflow-y-auto px-2 pb-2">
              {deletedBookmarks.length === 0 && (
                <p className="text-xs text-gray-600 px-2.5 py-3">
                  No deleted bookmarks saved yet
                </p>
              )}
              {deletedBookmarks.map((record) => {
                const isFolder = Array.isArray(record.node.children)

                return (
                  <div
                    key={record.id}
                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-gray-800/50 transition-colors text-left group"
                  >
                    <div className="w-3.5 h-3.5 rounded flex-shrink-0 mt-0.5 bg-gray-800 flex items-center justify-center">
                      {isFolder ? (
                        <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-300 truncate group-hover:text-white">
                        {record.title || 'Untitled'}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] text-red-300/70 truncate">
                          {isFolder ? 'Folder' : 'Bookmark'}
                        </span>
                        <span className="text-[10px] text-gray-700">·</span>
                        <span className="text-[10px] text-gray-600 truncate">
                          {formatRelativeDate(record.deletedAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestoreDeletedBookmark(record.id)}
                      disabled={restoringDeletedId === record.id}
                      className="px-2 py-1 text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors flex-shrink-0"
                    >
                      {restoringDeletedId === record.id ? '...' : 'Restore'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-800 flex-shrink-0">
        <p className="text-xs text-gray-600">
          Better Bookmarks<br />
          Made with ❤️ by&nbsp;
          <a href="https://x.com/ai_singhal" className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">@ai_singhal</a>
        </p>
      </div>
    </aside>
  )
}
