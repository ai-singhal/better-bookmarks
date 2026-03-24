import { useEffect, useState } from 'react'
import type { BookmarkReminderRecord } from '../../shared/types'
import {
  cancelReminder,
  getAllReminders,
  snoozeReminder,
} from '../../lib/reminderService'

export function Reminders() {
  const [reminders, setReminders] = useState<BookmarkReminderRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [workingBookmarkId, setWorkingBookmarkId] = useState<string | null>(null)

  useEffect(() => {
    void loadReminders()
  }, [])

  async function loadReminders() {
    setLoading(true)
    try {
      setReminders(await getAllReminders())
    } catch (err) {
      console.error('Failed to load reminders:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSnooze(bookmarkId: string) {
    setWorkingBookmarkId(bookmarkId)
    try {
      await snoozeReminder(bookmarkId, 60)
      await loadReminders()
    } finally {
      setWorkingBookmarkId(null)
    }
  }

  async function handleClear(reminder: BookmarkReminderRecord) {
    setWorkingBookmarkId(reminder.bookmarkId)
    try {
      await cancelReminder(reminder.bookmarkId, reminder.url)
      await loadReminders()
    } finally {
      setWorkingBookmarkId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-gray-800 px-6 py-5">
        <h2 className="text-lg font-semibold">Reminders</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Scheduled bookmark follow-ups, including recurring reminders.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {reminders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 text-center">
            <svg
              className="mb-4 h-16 w-16 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-gray-500">No reminders set</p>
            <p className="mt-1 text-xs text-gray-600">
              Add reminders from AI Chat to follow up on important bookmarks.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map((reminder) => {
              const isWorking = workingBookmarkId === reminder.bookmarkId
              const isOverdue = new Date(reminder.remindAt).getTime() < Date.now()

              return (
                <div
                  key={reminder.bookmarkId}
                  className="rounded-2xl border border-gray-800 bg-gray-900/55 p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-100">
                        {reminder.title}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{reminder.url}</p>
                      {reminder.note && (
                        <p className="mt-3 text-sm text-gray-300">{reminder.note}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span
                          className={`rounded-full px-2.5 py-1 ${
                            isOverdue
                              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                              : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                          }`}
                        >
                          {isOverdue ? 'Due now' : new Date(reminder.remindAt).toLocaleString()}
                        </span>
                        {reminder.recurring && (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 capitalize text-emerald-300">
                            {reminder.recurring}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          if (reminder.url) chrome.tabs.create({ url: reminder.url })
                        }}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-700"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => void handleSnooze(reminder.bookmarkId)}
                        disabled={isWorking}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-indigo-500 hover:text-white disabled:border-gray-800 disabled:text-gray-600"
                      >
                        {isWorking ? 'Working...' : 'Snooze 1h'}
                      </button>
                      <button
                        onClick={() => void handleClear(reminder)}
                        disabled={isWorking}
                        className="rounded-lg border border-red-900/40 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-900/20 disabled:border-gray-800 disabled:text-gray-600"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
