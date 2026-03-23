import { setupBookmarkListeners } from './bookmarkListeners'
import { setupMessageRouter } from './messageRouter'
import { setupAlarmHandler } from './alarmHandler'
import { restoreAlarmsOnStartup } from '../lib/reminderService'

// Initialize on service worker startup
chrome.action.setBadgeText({ text: '' })
setupBookmarkListeners()
setupMessageRouter()
setupAlarmHandler()
restoreAlarmsOnStartup().catch((err) => {
  console.error('[Better Bookmarks] Failed to restore reminders:', err)
})

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Better Bookmarks] Extension installed')
    // Open dashboard on first install
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/dashboard/index.html'),
    })
  }
})

console.log('[Better Bookmarks] Background service worker started')
