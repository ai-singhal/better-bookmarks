import type { BookmarkWithMetadata } from '../../shared/types'
import { truncateUrl, formatRelativeDate, getFaviconUrl } from '../../shared/utils'

interface RecentBookmarksProps {
  bookmarks: BookmarkWithMetadata[]
  folderNames: Map<string, string>
}

export function RecentBookmarks({ bookmarks, folderNames }: RecentBookmarksProps) {
  if (bookmarks.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-6">
        No bookmarks found
      </p>
    )
  }

  const handleClick = (url?: string) => {
    if (url) {
      chrome.tabs.create({ url })
      window.close()
    }
  }

  return (
    <div className="space-y-1">
      {bookmarks.map((bookmark) => {
        const folderName = bookmark.parentId
          ? folderNames.get(bookmark.parentId) || ''
          : ''

        return (
          <button
            key={bookmark.id}
            onClick={() => handleClick(bookmark.url)}
            className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors text-left group"
          >
            <img
              src={bookmark.url ? getFaviconUrl(bookmark.url) : ''}
              alt=""
              className="w-4 h-4 rounded flex-shrink-0 mt-0.5"
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
                    <span className="text-xs text-indigo-400/80 truncate max-w-[120px]">
                      {folderName}
                    </span>
                    <span className="text-gray-600 text-xs">·</span>
                  </>
                )}
                <p className="text-xs text-gray-500 truncate">
                  {bookmark.url ? truncateUrl(bookmark.url, 30) : 'Folder'}
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
  )
}
