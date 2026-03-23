import { ALARM_NAMES } from '../shared/constants'
import type { BookmarkReminderRecord } from '../shared/types'
import { setLookAtLater } from './bookmarkSync'
import { upsertBookmarkInsight } from './bookmarkInsightService'

function getReminderStorageKey(bookmarkId: string): string {
  return `reminder_${bookmarkId}`
}

async function persistReminder(record: BookmarkReminderRecord): Promise<void> {
  await chrome.storage.local.set({
    [getReminderStorageKey(record.bookmarkId)]: record,
  })
}

async function updateReminderAlarm(
  bookmarkId: string,
  remindAt: Date
): Promise<void> {
  const alarmName = `${ALARM_NAMES.REMINDER_PREFIX}${bookmarkId}`
  await chrome.alarms.create(alarmName, {
    when: remindAt.getTime(),
  })
}

export async function createReminder(
  bookmarkId: string,
  url: string,
  title: string,
  remindAt: Date,
  note?: string,
  recurring?: 'daily' | 'weekly' | 'monthly' | null
): Promise<void> {
  const now = new Date().toISOString()
  const record: BookmarkReminderRecord = {
    bookmarkId,
    title,
    url,
    note: note || '',
    remindAt: remindAt.toISOString(),
    recurring: recurring || null,
    createdAt: now,
    updatedAt: now,
  }

  await persistReminder(record)
  await updateReminderAlarm(bookmarkId, remindAt)
  await upsertBookmarkInsight(bookmarkId, {
    reminderAt: record.remindAt,
    reminderNote: record.note,
    recurring: record.recurring,
  })

  // Update Supabase
  await setLookAtLater(url, true, remindAt.toISOString(), note)
}

export async function cancelReminder(bookmarkId: string, url: string): Promise<void> {
  const alarmName = `${ALARM_NAMES.REMINDER_PREFIX}${bookmarkId}`

  await chrome.alarms.clear(alarmName)
  await chrome.storage.local.remove(getReminderStorageKey(bookmarkId))
  await upsertBookmarkInsight(bookmarkId, {
    reminderAt: undefined,
    reminderNote: undefined,
    recurring: null,
  })
  await setLookAtLater(url, false)
}

export async function snoozeReminder(
  bookmarkId: string,
  delayMinutes: number
): Promise<void> {
  const reminder = await getReminder(bookmarkId)
  if (!reminder) return

  const remindAt = new Date(Date.now() + delayMinutes * 60 * 1000)
  const nextReminder: BookmarkReminderRecord = {
    ...reminder,
    remindAt: remindAt.toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await persistReminder(nextReminder)
  await updateReminderAlarm(bookmarkId, remindAt)
  await upsertBookmarkInsight(bookmarkId, {
    reminderAt: nextReminder.remindAt,
    reminderNote: nextReminder.note,
    recurring: nextReminder.recurring,
  })
}

export async function restoreAlarmsOnStartup(): Promise<void> {
  // Service workers are ephemeral in MV3 — recreate alarms from stored data
  const all = await chrome.storage.local.get(null)

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('reminder_') || !value) continue

    const reminder = value as BookmarkReminderRecord

    const remindAt = new Date(reminder.remindAt).getTime()
    if (remindAt <= Date.now()) continue // Already past

    const alarmName = `${ALARM_NAMES.REMINDER_PREFIX}${reminder.bookmarkId}`
    const existing = await chrome.alarms.get(alarmName)
    if (existing) continue // Already set

    await chrome.alarms.create(alarmName, { when: remindAt })
  }
}

export async function getReminder(
  bookmarkId: string
): Promise<BookmarkReminderRecord | null> {
  const data = await chrome.storage.local.get(getReminderStorageKey(bookmarkId))
  return (data[getReminderStorageKey(bookmarkId)] as BookmarkReminderRecord) || null
}

export async function getAllReminders(): Promise<BookmarkReminderRecord[]> {
  const all = await chrome.storage.local.get(null)
  const reminders: BookmarkReminderRecord[] = []

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('reminder_') && value) {
      reminders.push(value as typeof reminders[number])
    }
  }

  return reminders.sort(
    (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
  )
}
