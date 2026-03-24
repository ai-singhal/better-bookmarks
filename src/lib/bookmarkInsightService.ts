import type { BookmarkInsight, BookmarkWithMetadata, FolderDescription, TriageRecord } from '../shared/types'

const INSIGHTS_STORAGE_KEY = 'bookmark_insights_v1'
const LEGACY_NOTES_STORAGE_KEY = 'bookmark_notes'
const FOLDER_DESCRIPTIONS_KEY = 'folder_descriptions_v1'
const TRIAGE_RECORDS_KEY = 'triage_records_v1'

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

// ─── Folder Descriptions ───

type FolderDescriptionMap = Record<string, FolderDescription>

export async function getFolderDescriptions(): Promise<FolderDescriptionMap> {
  const data = await chrome.storage.local.get(FOLDER_DESCRIPTIONS_KEY)
  return (data[FOLDER_DESCRIPTIONS_KEY] as FolderDescriptionMap) || {}
}

export async function getFolderDescription(folderId: string): Promise<FolderDescription | null> {
  const map = await getFolderDescriptions()
  return map[folderId] || null
}

export async function upsertFolderDescription(
  folderId: string,
  description: string,
  priority: FolderDescription['priority'] = 'medium'
): Promise<FolderDescription> {
  const map = await getFolderDescriptions()
  const now = new Date().toISOString()
  const entry: FolderDescription = { folderId, description: description.trim(), priority, updatedAt: now }
  map[folderId] = entry
  await chrome.storage.local.set({ [FOLDER_DESCRIPTIONS_KEY]: map })
  return entry
}

export async function removeFolderDescription(folderId: string): Promise<void> {
  const map = await getFolderDescriptions()
  delete map[folderId]
  await chrome.storage.local.set({ [FOLDER_DESCRIPTIONS_KEY]: map })
}

// ─── Triage Records ───

type TriageMap = Record<string, TriageRecord>

export async function getTriageRecords(): Promise<TriageMap> {
  const data = await chrome.storage.local.get(TRIAGE_RECORDS_KEY)
  return (data[TRIAGE_RECORDS_KEY] as TriageMap) || {}
}

export async function setTriageRecord(
  bookmarkId: string,
  status: TriageRecord['status'],
  note?: string
): Promise<TriageRecord> {
  const map = await getTriageRecords()
  const record: TriageRecord = {
    bookmarkId,
    status,
    note: note?.trim(),
    triageDate: new Date().toISOString(),
  }
  map[bookmarkId] = record
  await chrome.storage.local.set({ [TRIAGE_RECORDS_KEY]: map })
  return record
}

export async function clearTriageRecord(bookmarkId: string): Promise<void> {
  const map = await getTriageRecords()
  delete map[bookmarkId]
  await chrome.storage.local.set({ [TRIAGE_RECORDS_KEY]: map })
}

// ─── Attach insights to bookmarks ───

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
