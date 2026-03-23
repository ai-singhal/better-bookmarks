import type { BookmarkInsight, BookmarkWithMetadata } from '../shared/types'

const INSIGHTS_STORAGE_KEY = 'bookmark_insights_v1'
const LEGACY_NOTES_STORAGE_KEY = 'bookmark_notes'

type InsightMap = Record<string, BookmarkInsight>

export async function getBookmarkInsights(): Promise<InsightMap> {
  const data = await chrome.storage.local.get([
    INSIGHTS_STORAGE_KEY,
    LEGACY_NOTES_STORAGE_KEY,
  ])

  const insights = (data[INSIGHTS_STORAGE_KEY] as InsightMap) || {}
  const legacyNotes = (data[LEGACY_NOTES_STORAGE_KEY] as Record<string, string>) || {}

  if (Object.keys(legacyNotes).length === 0) {
    return insights
  }

  let migrated = false
  const nextInsights = { ...insights }
  const now = new Date().toISOString()

  for (const [bookmarkId, note] of Object.entries(legacyNotes)) {
    if (bookmarkId in nextInsights || !note.trim()) continue
    nextInsights[bookmarkId] = {
      bookmarkId,
      reason: note.trim(),
      tags: [],
      createdAt: now,
      updatedAt: now,
    }
    migrated = true
  }

  if (migrated) {
    await chrome.storage.local.set({ [INSIGHTS_STORAGE_KEY]: nextInsights })
  }

  return nextInsights
}

export async function getBookmarkInsight(
  bookmarkId: string
): Promise<BookmarkInsight | null> {
  const insights = await getBookmarkInsights()
  return insights[bookmarkId] || null
}

export async function upsertBookmarkInsight(
  bookmarkId: string,
  patch: Partial<Omit<BookmarkInsight, 'bookmarkId' | 'createdAt' | 'updatedAt'>>
): Promise<BookmarkInsight> {
  const insights = await getBookmarkInsights()
  const existing = insights[bookmarkId]
  const now = new Date().toISOString()

  const next: BookmarkInsight = {
    bookmarkId,
    reason: (
      'reason' in patch ? patch.reason : existing?.reason ?? ''
    )?.trim() || '',
    tags: 'tags' in patch ? patch.tags || [] : existing?.tags ?? [],
    summary: 'summary' in patch ? patch.summary : existing?.summary,
    reminderAt: 'reminderAt' in patch ? patch.reminderAt : existing?.reminderAt,
    reminderNote:
      'reminderNote' in patch ? patch.reminderNote : existing?.reminderNote,
    recurring:
      patch.recurring !== undefined
        ? patch.recurring
        : existing?.recurring ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }

  if (!next.summary?.trim()) delete next.summary
  if (!next.reminderAt) delete next.reminderAt
  if (!next.reminderNote?.trim()) delete next.reminderNote

  next.tags = next.tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index)

  insights[bookmarkId] = next
  await chrome.storage.local.set({ [INSIGHTS_STORAGE_KEY]: insights })
  return next
}

export async function removeBookmarkInsight(bookmarkId: string): Promise<void> {
  const insights = await getBookmarkInsights()
  if (!(bookmarkId in insights)) return

  delete insights[bookmarkId]
  await chrome.storage.local.set({ [INSIGHTS_STORAGE_KEY]: insights })
}

export async function attachInsightsToBookmarks(
  bookmarks: BookmarkWithMetadata[]
): Promise<BookmarkWithMetadata[]> {
  const insights = await getBookmarkInsights()

  const attach = (bookmark: BookmarkWithMetadata): BookmarkWithMetadata => ({
    ...bookmark,
    insight: insights[bookmark.id],
    children: bookmark.children?.map(attach),
  })

  return bookmarks.map(attach)
}
