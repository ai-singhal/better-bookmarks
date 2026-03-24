import { recordDeletedBookmark } from '../lib/deletedBookmarkService'
import { BOOKMARK_RESTORE_IN_PROGRESS_KEY } from '../lib/bookmarkSnapshotService'

const suppressedRemovedIds = new Set<string>()

function collectDescendantIds(node?: chrome.bookmarks.BookmarkTreeNode): string[] {
  if (!node?.children?.length) return []

  const ids: string[] = []
  for (const child of node.children) {
    ids.push(child.id)
    ids.push(...collectDescendantIds(child))
  }
  return ids
}

export function setupBookmarkListeners() {
  chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    console.log('[Bookmarks] Created:', id, bookmark.title)

    // Notify popup/dashboard of new bookmark
    chrome.runtime.sendMessage({
      type: 'BOOKMARK_CREATED',
      payload: { id, bookmark },
    }).catch(() => {
      // No listeners — popup/dashboard not open
    })

    // TODO: Phase 3 — trigger embedding generation
    // TODO: Phase 6 — show notification for new bookmark
  })

  chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
    console.log('[Bookmarks] Removed:', id)

    chrome.storage.local.get(BOOKMARK_RESTORE_IN_PROGRESS_KEY).then((data) => {
      const restoreInProgress = Boolean(data[BOOKMARK_RESTORE_IN_PROGRESS_KEY])

      if (suppressedRemovedIds.has(id)) {
        suppressedRemovedIds.delete(id)
        return
      }

      if (!restoreInProgress && removeInfo.node) {
        const descendantIds = collectDescendantIds(removeInfo.node)
        for (const descendantId of descendantIds) {
          suppressedRemovedIds.add(descendantId)
        }

        recordDeletedBookmark(id, removeInfo.node).catch((err) => {
          console.error('[Bookmarks] Failed to record deleted bookmark:', err)
        })
      }

      chrome.runtime.sendMessage({
        type: 'BOOKMARK_REMOVED',
        payload: { id, removeInfo },
      }).catch(() => {})
    }).catch(() => {
      chrome.runtime.sendMessage({
        type: 'BOOKMARK_REMOVED',
        payload: { id, removeInfo },
      }).catch(() => {})
    })
  })

  chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    console.log('[Bookmarks] Changed:', id, changeInfo)
    chrome.runtime.sendMessage({
      type: 'BOOKMARK_CHANGED',
      payload: { id, changeInfo },
    }).catch(() => {})
  })

  chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    console.log('[Bookmarks] Moved:', id, moveInfo)
    chrome.runtime.sendMessage({
      type: 'BOOKMARK_MOVED',
      payload: { id, moveInfo },
    }).catch(() => {})
  })
}
