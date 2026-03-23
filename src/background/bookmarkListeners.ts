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
    chrome.runtime.sendMessage({
      type: 'BOOKMARK_REMOVED',
      payload: { id, removeInfo },
    }).catch(() => {})
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
