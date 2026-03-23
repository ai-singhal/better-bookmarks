import { useEffect, useState } from 'react'
import type { BookmarkInsight, BookmarkWithMetadata } from '../../shared/types'
import { upsertBookmarkInsight } from '../../lib/bookmarkInsightService'
import { refreshIndexedBookmarkMetadata } from '../../lib/localSearchEngine'
import { cancelReminder, createReminder } from '../../lib/reminderService'

interface BookmarkInsightEditorProps {
  bookmark: BookmarkWithMetadata
  onInsightSaved?: (insight: BookmarkInsight) => void
}

function toDateTimeLocal(value?: string): string {
  if (!value) return ''

  const date = new Date(value)
  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60 * 1000)
  return localDate.toISOString().slice(0, 16)
}

function fromTagsInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function BookmarkInsightEditor({
  bookmark,
  onInsightSaved,
}: BookmarkInsightEditorProps) {
  const [reason, setReason] = useState(bookmark.insight?.reason || '')
  const [tagsInput, setTagsInput] = useState((bookmark.insight?.tags || []).join(', '))
  const [reminderAt, setReminderAt] = useState(toDateTimeLocal(bookmark.insight?.reminderAt))
  const [reminderNote, setReminderNote] = useState(bookmark.insight?.reminderNote || '')
  const [recurring, setRecurring] = useState<
    'daily' | 'weekly' | 'monthly' | ''
  >(bookmark.insight?.recurring || '')
  const [isSavingContext, setIsSavingContext] = useState(false)
  const [isSavingReminder, setIsSavingReminder] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setReason(bookmark.insight?.reason || '')
    setTagsInput((bookmark.insight?.tags || []).join(', '))
    setReminderAt(toDateTimeLocal(bookmark.insight?.reminderAt))
    setReminderNote(bookmark.insight?.reminderNote || '')
    setRecurring(bookmark.insight?.recurring || '')
  }, [bookmark.id, bookmark.insight])

  const handleSaveContext = async () => {
    setIsSavingContext(true)
    setStatus('')

    try {
      const insight = await upsertBookmarkInsight(bookmark.id, {
        reason,
        tags: fromTagsInput(tagsInput),
      })
      await refreshIndexedBookmarkMetadata(bookmark)
      onInsightSaved?.(insight)
      setStatus('Context saved')
    } catch (err) {
      console.error('Failed to save bookmark context:', err)
      setStatus('Save failed')
    } finally {
      setIsSavingContext(false)
    }
  }

  const handleSaveReminder = async () => {
    if (!bookmark.url) return

    setIsSavingReminder(true)
    setStatus('')

    try {
      if (!reminderAt) {
        await cancelReminder(bookmark.id, bookmark.url)
        const clearedInsight = await upsertBookmarkInsight(bookmark.id, {
          reminderAt: undefined,
          reminderNote: undefined,
          recurring: null,
        })
        setReminderNote('')
        setRecurring('')
        await refreshIndexedBookmarkMetadata(bookmark)
        onInsightSaved?.(clearedInsight)
        setStatus('Reminder cleared')
        return
      }

      const remindAtDate = new Date(reminderAt)
      await createReminder(
        bookmark.id,
        bookmark.url,
        bookmark.title || 'Untitled',
        remindAtDate,
        reminderNote,
        recurring || null
      )

      const insight = await upsertBookmarkInsight(bookmark.id, {
        reminderAt: remindAtDate.toISOString(),
        reminderNote,
        recurring: recurring || null,
      })
      await refreshIndexedBookmarkMetadata(bookmark)
      onInsightSaved?.(insight)
      setStatus('Reminder saved')
    } catch (err) {
      console.error('Failed to save reminder:', err)
      setStatus('Reminder failed')
    } finally {
      setIsSavingReminder(false)
    }
  }

  return (
    <div className="mt-3 grid gap-3 border-t border-gray-800 pt-3">
      <div className="grid gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
          Why You Saved It
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Brief reason, context, or what makes this useful"
          rows={3}
          className="w-full resize-none rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-indigo-500"
        />
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="Tags, comma separated"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-indigo-500"
          />
          <button
            onClick={handleSaveContext}
            disabled={isSavingContext}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500"
          >
            {isSavingContext ? 'Saving...' : 'Save Context'}
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
          Reminder
        </label>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
          <input
            type="datetime-local"
            value={reminderAt}
            onChange={(e) => setReminderAt(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-indigo-500"
          />
          <select
            value={recurring}
            onChange={(e) =>
              setRecurring(e.target.value as 'daily' | 'weekly' | 'monthly' | '')
            }
            className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-indigo-500"
          >
            <option value="">One time</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            value={reminderNote}
            onChange={(e) => setReminderNote(e.target.value)}
            placeholder="Optional reminder note"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-indigo-500"
          />
          <button
            onClick={handleSaveReminder}
            disabled={isSavingReminder}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-indigo-500 hover:text-white disabled:border-gray-800 disabled:text-gray-500"
          >
            {isSavingReminder ? 'Saving...' : reminderAt ? 'Save Reminder' : 'Clear Reminder'}
          </button>
        </div>
      </div>

      {status && <p className="text-xs text-gray-500">{status}</p>}
    </div>
  )
}
