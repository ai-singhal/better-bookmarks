import { useState, useEffect } from 'react'

interface Reminder {
  bookmarkId: string
  title: string
  url: string
  note: string
  remindAt: string
}

export function Reminders() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadReminders()
  }, [])

  async function loadReminders() {
    setLoading(true)
    try {
      // Load all reminder_ keys from storage
      const all = await chrome.storage.local.get(null)
      const reminderList: Reminder[] = []

      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('reminder_') && value) {
          const r = value as Reminder
          reminderList.push(r)
        }
      }

      reminderList.sort(
        (a, b) =>
          new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()
      )
      setReminders(reminderList)
    } catch (err) {
      console.error('Failed to load reminders:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800">
        <h2 className="text-lg font-semibold">Reminders</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Bookmarks you want to look at later
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg
              className="w-16 h-16 text-gray-700 mb-4"
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
            <p className="text-gray-500 text-sm">No reminders set</p>
            <p className="text-gray-600 text-xs mt-1">
              Set reminders on bookmarks to be notified when to check them
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reminders.map((reminder) => (
              <div
                key={reminder.bookmarkId}
                className="flex items-center gap-3 p-4 rounded-lg bg-gray-900/50 border border-gray-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-200">
                    {reminder.title}
                  </p>
                  {reminder.note && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {reminder.note}
                    </p>
                  )}
                  <p className="text-xs text-indigo-400 mt-1">
                    {new Date(reminder.remindAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (reminder.url)
                      chrome.tabs.create({ url: reminder.url })
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
