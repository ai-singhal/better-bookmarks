import { ALARM_NAMES } from '../shared/constants'
import type { BookmarkReminderRecord } from '../shared/types'
import {
  cancelReminder,
  createReminder,
  getReminder,
  snoozeReminder,
} from '../lib/reminderService'

export function setupAlarmHandler() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(ALARM_NAMES.REMINDER_PREFIX)) {
      handleReminderAlarm(alarm)
    } else if (alarm.name === ALARM_NAMES.BATCH_PROCESS) {
      handleBatchProcessAlarm()
    } else if (alarm.name === ALARM_NAMES.SYNC_CHECK) {
      handleSyncCheckAlarm()
    }
  })
}

async function handleReminderAlarm(alarm: chrome.alarms.Alarm) {
  const bookmarkId = alarm.name.replace(ALARM_NAMES.REMINDER_PREFIX, '')

  // Get stored reminder details
  const key = `reminder_${bookmarkId}`
  const data = await chrome.storage.local.get(key)
  const reminder = data[key] as BookmarkReminderRecord | undefined

  if (!reminder) return

  // Get bookmark details
  try {
    const [bookmark] = await chrome.bookmarks.get(bookmarkId)
    chrome.notifications.create(`reminder_${bookmarkId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
      title: 'Bookmark Reminder',
      message: reminder.note || `Time to check: ${bookmark.title}`,
      buttons: [{ title: 'Open' }, { title: 'Snooze 1h' }],
      priority: 2,
    })

    if (reminder.recurring) {
      const nextAt = getNextRecurringDate(
        reminder.remindAt,
        reminder.recurring
      )
      await createReminder(
        bookmarkId,
        reminder.url,
        reminder.title || bookmark.title,
        nextAt,
        reminder.note,
        reminder.recurring
      )
    }
  } catch {
    // Bookmark may have been deleted
    await chrome.storage.local.remove(key)
  }
}

async function handleBatchProcessAlarm() {
  // TODO: Phase 3 — process next batch of embeddings
  console.log('[Alarms] Batch process triggered')
}

async function handleSyncCheckAlarm() {
  // TODO: Phase 8 — check for cross-device sync updates
  console.log('[Alarms] Sync check triggered')
}

// Handle notification clicks
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('reminder_')) return

    const bookmarkId = notificationId.replace('reminder_', '')
    const reminder = await getReminder(bookmarkId)

    if (buttonIndex === 0) {
      // Open the bookmark
      try {
        const [bookmark] = await chrome.bookmarks.get(bookmarkId)
        if (bookmark.url) {
          chrome.tabs.create({ url: bookmark.url })
        }
        if (!reminder?.recurring && bookmark.url) {
          await cancelReminder(bookmarkId, bookmark.url)
        }
      } catch {
        // Bookmark deleted
      }
    } else if (buttonIndex === 1) {
      // Snooze 1 hour
      await snoozeReminder(bookmarkId, 60)
    }

    chrome.notifications.clear(notificationId)
  }
)

function getNextRecurringDate(
  remindAtIso: string,
  recurring: 'daily' | 'weekly' | 'monthly'
): Date {
  const nextDate = new Date(remindAtIso)

  if (recurring === 'daily') nextDate.setDate(nextDate.getDate() + 1)
  if (recurring === 'weekly') nextDate.setDate(nextDate.getDate() + 7)
  if (recurring === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1)

  return nextDate
}
