// Local AI search engine using TF-IDF vectorization + BM25 scoring.
// Works client-side and indexes bookmark titles, notes, parsed page content,
// reminder metadata, and topical clusters for faster semantic retrieval.

import type {
  BookmarkInsight,
  BookmarkWithMetadata,
} from '../shared/types'
import {
  getBookmarkInsight,
  getBookmarkInsights,
  upsertBookmarkInsight,
} from './bookmarkInsightService'
import { parsePage, type ParsedPage } from './pageParser'
import {
  getExpandedTerms,
  parseQuery,
  type ParsedQuery,
  type TimeFilter,
} from './queryParser'

export interface IndexedBookmark {
  chromeId: string
  url: string
  title: string
  dateAdded: number
  parentId?: string
  domain: string
  reason: string
  tags: string[]
  summary: string
  reminderAt?: string
  reminderNote?: string
  recurring?: 'daily' | 'weekly' | 'monthly' | null
  pageTitle: string
  pageDescription: string
  headings: string[]
  keywords: string[]
  author: string
  publishDate: string
  pageContent: string
  lastIndexedAt: number
  clusterId?: string
  clusterLabel?: string
  clusterKeywords?: string[]
  intentHints: string[]
  topTerms: string[]
  tokens: string[]
  tfVector: Map<string, number>
}

export interface SearchResult {
  bookmark: BookmarkWithMetadata
  score: number
  matchReasons: string[]
  highlights: string[]
  excerpt: string
  clusterLabel?: string
}

export interface SearchIndex {
  bookmarks: Map<string, IndexedBookmark>
  invertedIndex: Map<string, Set<string>>
  documentFrequency: Map<string, number>
  totalDocuments: number
  avgDocLength: number
  lastUpdated: number
}

export interface IndexingProgress {
  phase: 'fetching' | 'parsing' | 'indexing' | 'done'
  current: number
  total: number
  currentUrl?: string
}

export interface BookmarkCluster {
  id: string
  label: string
  keywords: string[]
  bookmarkIds: string[]
  size: number
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'it', 'that', 'this', 'was', 'are', 'be', 'has',
  'had', 'have', 'been', 'will', 'can', 'do', 'does', 'did', 'not', 'no',
  'so', 'if', 'as', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'she', 'his', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  'when', 'where', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about',
  'into', 'over', 'under', 'their', 'your', 'ours', 'because', 'while',
  'also', 'only', 'really', 'still',
])

const BM25_K1 = 1.5
const BM25_B = 0.75
const SEARCH_INDEX_TTL_MS = 12 * 60 * 60 * 1000
const PAGE_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000
const INDEX_STORAGE_KEY = 'search_index_v3'
const INDEX_SIGNATURE_STORAGE_KEY = 'search_index_signature_v1'

function createEmptyIndex(): SearchIndex {
  return {
    bookmarks: new Map(),
    invertedIndex: new Map(),
    documentFrequency: new Map(),
    totalDocuments: 0,
    avgDocLength: 0,
    lastUpdated: 0,
  }
}

let searchIndex: SearchIndex = createEmptyIndex()
let searchIndexSignature = ''

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\-./]/g, ' ')
    .split(/[\s\-_./]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function stem(word: string): string {
  if (word.length < 4) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3)
  if (word.endsWith('tion')) return word.slice(0, -4)
  if (word.endsWith('ment')) return word.slice(0, -4)
  if (word.endsWith('ness')) return word.slice(0, -4)
  if (word.endsWith('able')) return word.slice(0, -4)
  if (word.endsWith('ful')) return word.slice(0, -3)
  if (word.endsWith('less')) return word.slice(0, -4)
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('est') && word.length > 4) return word.slice(0, -3)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1)
  return word
}

function processTokens(text: string): string[] {
  return tokenize(text).map(stem)
}

function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()

  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1)
  }

  const length = tokens.length || 1
  for (const [term, count] of tf) {
    tf.set(term, count / length)
  }

  return tf
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  docTF: Map<string, number>,
  documentFrequency: Map<string, number>,
  totalDocs: number,
  avgDocLength: number
): number {
  const docLength = docTokens.length || 1
  let score = 0

  for (const token of queryTokens) {
    const df = documentFrequency.get(token) || 0
    if (df === 0) continue

    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1)
    const rawTF = (docTF.get(token) || 0) * docLength
    const tfNorm =
      (rawTF * (BM25_K1 + 1)) /
      (rawTF + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / (avgDocLength || 1))))

    score += idf * tfNorm
  }

  return score
}

function buildInsightFromIndexedBookmark(
  indexed: IndexedBookmark
): BookmarkInsight {
  const now = new Date(indexed.lastIndexedAt).toISOString()
  return {
    bookmarkId: indexed.chromeId,
    reason: indexed.reason,
    tags: indexed.tags,
    summary: indexed.summary || undefined,
    reminderAt: indexed.reminderAt,
    reminderNote: indexed.reminderNote,
    recurring: indexed.recurring || null,
    createdAt: now,
    updatedAt: now,
  }
}

function buildDocumentText(bookmark: IndexedBookmark): string {
  const parts = [
    bookmark.title,
    bookmark.title,
    bookmark.title,
    bookmark.pageTitle,
    bookmark.pageTitle,
    bookmark.reason,
    bookmark.reason,
    bookmark.reason,
    bookmark.tags.join(' '),
    bookmark.tags.join(' '),
    bookmark.summary,
    bookmark.summary,
    bookmark.pageDescription,
    bookmark.pageDescription,
    bookmark.headings.join(' '),
    bookmark.keywords.join(' '),
    bookmark.author,
    bookmark.domain,
    bookmark.reminderNote || '',
    bookmark.pageContent,
  ]

  return parts.filter(Boolean).join(' ')
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function inferIntentHints(bookmark: IndexedBookmark): string[] {
  const text = [
    bookmark.title,
    bookmark.pageTitle,
    bookmark.reason,
    bookmark.summary,
    bookmark.pageDescription,
    bookmark.keywords.join(' '),
    bookmark.headings.join(' '),
    bookmark.url,
  ]
    .join(' ')
    .toLowerCase()

  const hints = new Set<string>()

  if (
    /\b(person|profile|portfolio|researcher|engineer|developer|founder|creator|author)\b/.test(text) ||
    /(github\.com|linkedin\.com|x\.com|twitter\.com)/.test(bookmark.domain)
  ) {
    hints.add('person')
  }
  if (/\b(tool|library|framework|package|sdk|app|software|cli)\b/.test(text)) {
    hints.add('tool')
  }
  if (/\b(tutorial|guide|course|walkthrough|learn|lesson)\b/.test(text)) {
    hints.add('learning')
  }
  if (/\b(article|blog|post|essay|newsletter)\b/.test(text)) {
    hints.add('article')
  }
  if (/\b(video|youtube|watch|stream|talk)\b/.test(text)) {
    hints.add('video')
  }
  if (/\b(research|paper|arxiv|study|publication)\b/.test(text)) {
    hints.add('research')
  }
  if (/\b(repo|repository|github|open source|source code)\b/.test(text)) {
    hints.add('code')
  }

  return [...hints]
}

function computeBookmarksSignature(bookmarks: BookmarkWithMetadata[]): string {
  return bookmarks
    .filter((bookmark) => bookmark.url)
    .map((bookmark) =>
      [
        bookmark.id,
        bookmark.url,
        bookmark.title,
        String(bookmark.dateAdded || 0),
        bookmark.parentId || '',
      ].join('|')
    )
    .sort()
    .join('||')
}

function serializeIndex(index: SearchIndex): string {
  const payload = {
    bookmarks: Array.from(index.bookmarks.entries()).map(([key, value]) => [
      key,
      {
        ...value,
        tfVector: Array.from(value.tfVector.entries()),
      },
    ]),
    invertedIndex: Array.from(index.invertedIndex.entries()).map(([key, value]) => [
      key,
      Array.from(value),
    ]),
    documentFrequency: Array.from(index.documentFrequency.entries()),
    totalDocuments: index.totalDocuments,
    avgDocLength: index.avgDocLength,
    lastUpdated: index.lastUpdated,
  }

  return JSON.stringify(payload)
}

function deserializeIndex(json: string): SearchIndex | null {
  try {
    const payload = JSON.parse(json) as {
      bookmarks: Array<[string, IndexedBookmark & { tfVector: [string, number][] }]>
      invertedIndex: Array<[string, string[]]>
      documentFrequency: Array<[string, number]>
      totalDocuments: number
      avgDocLength: number
      lastUpdated: number
    }

    return {
      bookmarks: new Map(
        payload.bookmarks.map(([key, value]) => [
          key,
          {
            ...value,
            tfVector: new Map(value.tfVector),
          },
        ])
      ),
      invertedIndex: new Map(
        payload.invertedIndex.map(([key, value]) => [key, new Set(value)])
      ),
      documentFrequency: new Map(payload.documentFrequency),
      totalDocuments: payload.totalDocuments,
      avgDocLength: payload.avgDocLength,
      lastUpdated: payload.lastUpdated,
    }
  } catch {
    return null
  }
}

async function saveIndex(signature = searchIndexSignature): Promise<void> {
  const json = serializeIndex(searchIndex)
  searchIndexSignature = signature
  await chrome.storage.local.set({
    [INDEX_STORAGE_KEY]: json,
    [INDEX_SIGNATURE_STORAGE_KEY]: signature,
  })
}

function computeTopTermsForBookmark(bookmark: IndexedBookmark): string[] {
  const weightedTerms = Array.from(bookmark.tfVector.entries())
    .map(([term, tf]) => {
      const df = searchIndex.documentFrequency.get(term) || 1
      const idf = Math.log((searchIndex.totalDocuments + 1) / df)
      return [term, tf * idf] as const
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term)

  return weightedTerms
}

function rebuildIndexStructures(): void {
  searchIndex.invertedIndex = new Map()
  searchIndex.documentFrequency = new Map()

  let totalLength = 0

  for (const bookmark of searchIndex.bookmarks.values()) {
    const documentText = buildDocumentText(bookmark)
    const tokens = processTokens(documentText)
    bookmark.tokens = tokens
    bookmark.tfVector = computeTF(tokens)
    bookmark.intentHints = inferIntentHints(bookmark)

    totalLength += tokens.length
    const uniqueTerms = new Set(tokens)

    for (const term of uniqueTerms) {
      if (!searchIndex.invertedIndex.has(term)) {
        searchIndex.invertedIndex.set(term, new Set())
      }
      searchIndex.invertedIndex.get(term)?.add(bookmark.chromeId)
    }
  }

  for (const [term, bookmarkIds] of searchIndex.invertedIndex) {
    searchIndex.documentFrequency.set(term, bookmarkIds.size)
  }

  searchIndex.totalDocuments = searchIndex.bookmarks.size
  searchIndex.avgDocLength = totalLength / (searchIndex.totalDocuments || 1)

  for (const bookmark of searchIndex.bookmarks.values()) {
    bookmark.topTerms = computeTopTermsForBookmark(bookmark)
  }

  assignClustersToIndex()
  searchIndex.lastUpdated = Date.now()
}

function shouldRefreshPage(
  existing: IndexedBookmark | undefined,
  bookmark: BookmarkWithMetadata
): boolean {
  if (!existing) return true
  if (existing.url !== bookmark.url) return true
  if (!existing.pageContent) return true
  return Date.now() - (existing.lastIndexedAt || 0) > PAGE_REFRESH_TTL_MS
}

function buildIndexedBookmark(params: {
  bookmark: BookmarkWithMetadata
  parsedPage: ParsedPage | null
  existing?: IndexedBookmark
  insight?: BookmarkInsight | null
}): IndexedBookmark {
  const { bookmark, parsedPage, existing, insight } = params
  const domain = getDomain(bookmark.url || '')
  const hasInsight = insight !== null && insight !== undefined
  const indexed: IndexedBookmark = {
    chromeId: bookmark.id,
    url: bookmark.url || '',
    title: bookmark.title || parsedPage?.title || existing?.title || '',
    dateAdded: bookmark.dateAdded || Date.now(),
    parentId: bookmark.parentId,
    domain,
    reason: hasInsight ? insight.reason : existing?.reason || '',
    tags: hasInsight ? insight.tags : existing?.tags || [],
    summary:
      (hasInsight ? insight.summary : undefined) ||
      parsedPage?.description ||
      existing?.summary ||
      '',
    reminderAt: hasInsight ? insight.reminderAt : existing?.reminderAt,
    reminderNote: hasInsight ? insight.reminderNote : existing?.reminderNote,
    recurring:
      hasInsight && insight.recurring !== undefined
        ? insight.recurring
        : existing?.recurring || null,
    pageTitle: parsedPage?.title || existing?.pageTitle || bookmark.title || '',
    pageDescription:
      parsedPage?.description || existing?.pageDescription || '',
    headings: parsedPage?.headings || existing?.headings || [],
    keywords: parsedPage?.keywords || existing?.keywords || [],
    author: parsedPage?.author || existing?.author || '',
    publishDate: parsedPage?.publishDate || existing?.publishDate || '',
    pageContent: parsedPage?.fullText || existing?.pageContent || '',
    lastIndexedAt: parsedPage ? Date.now() : existing?.lastIndexedAt || Date.now(),
    clusterId: existing?.clusterId,
    clusterLabel: existing?.clusterLabel,
    clusterKeywords: existing?.clusterKeywords,
    intentHints: existing?.intentHints || [],
    topTerms: existing?.topTerms || [],
    tokens: existing?.tokens || [],
    tfVector: existing?.tfVector || new Map(),
  }

  return indexed
}

export async function loadIndex(): Promise<boolean> {
  const data = await chrome.storage.local.get([
    INDEX_STORAGE_KEY,
    INDEX_SIGNATURE_STORAGE_KEY,
  ])
  const json = data[INDEX_STORAGE_KEY]
  const signature = (data[INDEX_SIGNATURE_STORAGE_KEY] as string) || ''

  if (!json) return false

  const loaded = deserializeIndex(json as string)
  if (!loaded) return false

  searchIndex = loaded
  searchIndexSignature = signature

  // Recompute on older indexes that predate cluster/intention enrichment.
  let needsRebuild = false
  for (const bookmark of searchIndex.bookmarks.values()) {
    if (!bookmark.intentHints || !bookmark.topTerms) {
      needsRebuild = true
      break
    }
  }

  if (needsRebuild) {
    rebuildIndexStructures()
  }

  return true
}

export async function ensureIndex(
  bookmarks: BookmarkWithMetadata[],
  onProgress?: (progress: IndexingProgress) => void
): Promise<void> {
  if (searchIndex.totalDocuments === 0) {
    await loadIndex()
  }

  const signature = computeBookmarksSignature(bookmarks)
  const isStale = Date.now() - searchIndex.lastUpdated > SEARCH_INDEX_TTL_MS
  const hasChanges = signature !== searchIndexSignature
  const needsIndex =
    searchIndex.totalDocuments === 0 || hasChanges || isStale

  if (needsIndex) {
    await indexBookmarks(bookmarks, onProgress)
  }
}

export async function getBookmarkNotes(): Promise<Record<string, string>> {
  const insights = await getBookmarkInsights()
  return Object.fromEntries(
    Object.entries(insights).map(([bookmarkId, insight]) => [
      bookmarkId,
      insight.reason || '',
    ])
  )
}

export async function setBookmarkNote(
  chromeId: string,
  note: string
): Promise<void> {
  await upsertBookmarkInsight(chromeId, { reason: note })

  const existing = searchIndex.bookmarks.get(chromeId)
  if (!existing) return

  existing.reason = note.trim()
  rebuildIndexStructures()
  await saveIndex()
}

export async function getBookmarkNote(chromeId: string): Promise<string> {
  return (await getBookmarkInsight(chromeId))?.reason || ''
}

export async function indexBookmarks(
  bookmarks: BookmarkWithMetadata[],
  onProgress?: (progress: IndexingProgress) => void
): Promise<void> {
  const insights = await getBookmarkInsights()
  const urlBookmarks = bookmarks.filter((bookmark): bookmark is BookmarkWithMetadata & { url: string } => Boolean(bookmark.url))
  const total = urlBookmarks.length
  const parsedPages = new Map<string, ParsedPage>()

  const urlsToFetch = urlBookmarks.filter((bookmark) => {
    const existing = searchIndex.bookmarks.get(bookmark.id)
    return shouldRefreshPage(existing, bookmark)
  })

  onProgress?.({ phase: 'fetching', current: 0, total: urlsToFetch.length })

  let fetched = 0
  for (let i = 0; i < urlsToFetch.length; i += 5) {
    const batch = urlsToFetch.slice(i, i + 5)

    await Promise.allSettled(
      batch.map(async (bookmark) => {
        onProgress?.({
          phase: 'parsing',
          current: fetched,
          total: urlsToFetch.length,
          currentUrl: bookmark.url,
        })
        const parsed = await parsePage(bookmark.url)
        if (parsed) parsedPages.set(bookmark.url, parsed)
        fetched += 1
        onProgress?.({
          phase: 'parsing',
          current: fetched,
          total: urlsToFetch.length,
          currentUrl: bookmark.url,
        })
      })
    )
  }

  onProgress?.({ phase: 'indexing', current: 0, total })

  const nextIndex = createEmptyIndex()

  for (let i = 0; i < urlBookmarks.length; i++) {
    const bookmark = urlBookmarks[i]
    const existing = searchIndex.bookmarks.get(bookmark.id)
    const parsedPage = parsedPages.get(bookmark.url) || null
    const insight = insights[bookmark.id]

    nextIndex.bookmarks.set(
      bookmark.id,
      buildIndexedBookmark({
        bookmark,
        parsedPage,
        existing,
        insight,
      })
    )

    if (i % 25 === 0) {
      onProgress?.({ phase: 'indexing', current: i, total })
    }
  }

  searchIndex = nextIndex
  rebuildIndexStructures()
  searchIndexSignature = computeBookmarksSignature(urlBookmarks)
  await saveIndex(searchIndexSignature)
  onProgress?.({ phase: 'done', current: total, total })
}

export async function indexSingleBookmark(
  bookmark: BookmarkWithMetadata
): Promise<void> {
  if (!bookmark.url) return

  const existing = searchIndex.bookmarks.get(bookmark.id)
  const insight = await getBookmarkInsight(bookmark.id)
  const parsedPage = await parsePage(bookmark.url)

  searchIndex.bookmarks.set(
    bookmark.id,
    buildIndexedBookmark({
      bookmark,
      parsedPage,
      existing,
      insight,
    })
  )

  rebuildIndexStructures()
  await saveIndex()
}

export async function refreshIndexedBookmarkMetadata(
  bookmark: BookmarkWithMetadata
): Promise<void> {
  if (!bookmark.url) return

  const existing = searchIndex.bookmarks.get(bookmark.id)
  if (!existing) {
    await indexSingleBookmark(bookmark)
    return
  }

  const insight = await getBookmarkInsight(bookmark.id)

  searchIndex.bookmarks.set(
    bookmark.id,
    buildIndexedBookmark({
      bookmark,
      parsedPage: null,
      existing,
      insight,
    })
  )

  rebuildIndexStructures()
  await saveIndex()
}

export function removeFromIndex(chromeId: string): void {
  if (!searchIndex.bookmarks.has(chromeId)) return

  searchIndex.bookmarks.delete(chromeId)
  rebuildIndexStructures()
  void saveIndex()
}

function applyTimeFilter(
  results: SearchResult[],
  timeFilter: TimeFilter
): SearchResult[] {
  return results.filter((result) => {
    const addedAt = result.bookmark.dateAdded || 0
    return addedAt >= timeFilter.after && addedAt <= timeFilter.before
  })
}

function buildExcerpt(indexed: IndexedBookmark, searchWords: string[]): string {
  const candidates = [
    indexed.reason,
    indexed.summary,
    indexed.pageDescription,
    indexed.headings.join(' '),
    indexed.pageContent,
  ].filter(Boolean)

  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase()
    const matchedWord = searchWords.find((word) => lowerCandidate.includes(word))
    if (!matchedWord) continue

    const matchIndex = lowerCandidate.indexOf(matchedWord)
    const start = Math.max(0, matchIndex - 48)
    const end = Math.min(candidate.length, matchIndex + 112)
    return candidate.slice(start, end).trim()
  }

  return (
    indexed.reason ||
    indexed.summary ||
    indexed.pageDescription ||
    indexed.headings[0] ||
    indexed.pageContent.slice(0, 160)
  )
}

function getCandidateBookmarks(queryTokens: string[], searchLower: string): Set<string> {
  const candidates = new Set<string>()

  for (const token of queryTokens) {
    const docs = searchIndex.invertedIndex.get(token)
    if (!docs) continue

    for (const docId of docs) {
      candidates.add(docId)
    }
  }

  if (candidates.size > 0) return candidates

  for (const [docId, indexed] of searchIndex.bookmarks) {
    const searchableText = [
      indexed.title,
      indexed.pageTitle,
      indexed.reason,
      indexed.summary,
      indexed.pageDescription,
      indexed.headings.join(' '),
      indexed.tags.join(' '),
      indexed.domain,
    ]
      .join(' ')
      .toLowerCase()

    if (searchableText.includes(searchLower)) {
      candidates.add(docId)
    }
  }

  return candidates
}

function scoreIntentBoost(
  parsedQuery: ParsedQuery,
  indexed: IndexedBookmark
): number {
  if (parsedQuery.intentHints.length === 0) return 0

  const sharedHints = parsedQuery.intentHints.filter((hint) =>
    indexed.intentHints.includes(hint)
  )

  return sharedHints.length * 1.6
}

export function search(
  query: string,
  limit = 50
): { results: SearchResult[]; parsedQuery: ParsedQuery } {
  const parsedQuery = parseQuery(query)

  if (!parsedQuery.searchTerms && !parsedQuery.timeFilter) {
    return { results: [], parsedQuery }
  }

  if (!parsedQuery.searchTerms && parsedQuery.timeFilter) {
    const results = Array.from(searchIndex.bookmarks.values())
      .filter((indexed) => {
        const addedAt = indexed.dateAdded || 0
        return (
          addedAt >= parsedQuery.timeFilter!.after &&
          addedAt <= parsedQuery.timeFilter!.before
        )
      })
      .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
      .slice(0, limit)
      .map((indexed) => ({
        bookmark: {
          id: indexed.chromeId,
          parentId: indexed.parentId,
          title: indexed.title,
          url: indexed.url,
          dateAdded: indexed.dateAdded,
          insight: buildInsightFromIndexedBookmark(indexed),
        },
        score: indexed.dateAdded,
        matchReasons: [`Added ${new Date(indexed.dateAdded).toLocaleDateString()}`],
        highlights: [],
        excerpt: indexed.summary || indexed.pageDescription || indexed.reason,
        clusterLabel: indexed.clusterLabel,
      }))

    return { results, parsedQuery }
  }

  const expandedTerms = getExpandedTerms(parsedQuery.searchTerms)
  const queryTokens = [
    ...new Set(expandedTerms.flatMap((term) => processTokens(term))),
  ]
  const searchLower = parsedQuery.searchTerms.toLowerCase()
  const searchWords = searchLower.split(/\s+/).filter(Boolean)
  const candidates = getCandidateBookmarks(queryTokens, searchLower)

  let results: SearchResult[] = []

  for (const docId of candidates) {
    const indexed = searchIndex.bookmarks.get(docId)
    if (!indexed) continue

    const baseScore = bm25Score(
      queryTokens,
      indexed.tokens,
      indexed.tfVector,
      searchIndex.documentFrequency,
      searchIndex.totalDocuments,
      searchIndex.avgDocLength
    )

    const haystack = [
      indexed.title,
      indexed.pageTitle,
      indexed.reason,
      indexed.summary,
      indexed.pageDescription,
      indexed.headings.join(' '),
      indexed.tags.join(' '),
      indexed.domain,
      indexed.pageContent,
    ]
      .join(' ')
      .toLowerCase()

    const matchReasons: string[] = []
    const highlights = new Set<string>()
    let score = baseScore

    const exactPhraseMatch = searchLower.length > 2 && haystack.includes(searchLower)
    const titleMatch = searchWords.some((word) =>
      indexed.title.toLowerCase().includes(word) ||
      indexed.pageTitle.toLowerCase().includes(word)
    )
    const reasonMatch = searchWords.some((word) =>
      indexed.reason.toLowerCase().includes(word)
    )
    const tagMatch = searchWords.some((word) =>
      indexed.tags.some((tag) => tag.toLowerCase().includes(word))
    )
    const summaryMatch = searchWords.some((word) =>
      indexed.summary.toLowerCase().includes(word) ||
      indexed.pageDescription.toLowerCase().includes(word)
    )
    const contentMatch = searchWords.some((word) =>
      indexed.pageContent.toLowerCase().includes(word)
    )
    const domainMatch = searchWords.some((word) =>
      indexed.domain.toLowerCase().includes(word)
    )

    if (exactPhraseMatch) {
      score += 6
      matchReasons.push('Phrase match')
    }
    if (titleMatch) {
      score += 4
      matchReasons.push('Title match')
    }
    if (reasonMatch) {
      score += 5
      matchReasons.push('Saved reason match')
    }
    if (tagMatch) {
      score += 3.5
      matchReasons.push('Tag match')
    }
    if (summaryMatch) {
      score += 2.5
      matchReasons.push('Summary match')
    }
    if (domainMatch) {
      score += 1.5
      matchReasons.push('Domain match')
    }
    if (contentMatch) {
      score += 1.5
      matchReasons.push('Page content match')
    }

    score += scoreIntentBoost(parsedQuery, indexed)
    if (parsedQuery.intentHints.length > 0 && scoreIntentBoost(parsedQuery, indexed) > 0) {
      matchReasons.push('Intent match')
    }

    if (parsedQuery.timeFilter) {
      const addedAt = indexed.dateAdded || 0
      if (
        addedAt >= parsedQuery.timeFilter.after &&
        addedAt <= parsedQuery.timeFilter.before
      ) {
        score += 2
        matchReasons.push(parsedQuery.timeFilter.label)
      }
    } else {
      const ageInDays = Math.max(0, (Date.now() - indexed.dateAdded) / (24 * 60 * 60 * 1000))
      score += Math.max(0, 1 - ageInDays / 60)
    }

    for (const word of searchWords) {
      if (haystack.includes(word)) {
        highlights.add(word)
      }
    }

    if (score <= 0) continue

    results.push({
      bookmark: {
        id: indexed.chromeId,
        parentId: indexed.parentId,
        title: indexed.title,
        url: indexed.url,
        dateAdded: indexed.dateAdded,
        insight: buildInsightFromIndexedBookmark(indexed),
      },
      score,
      matchReasons,
      highlights: [...highlights],
      excerpt: buildExcerpt(indexed, searchWords),
      clusterLabel: indexed.clusterLabel,
    })
  }

  if (parsedQuery.timeFilter) {
    results = applyTimeFilter(results, parsedQuery.timeFilter)
  }

  results.sort((a, b) => b.score - a.score)

  return {
    results: results.slice(0, limit),
    parsedQuery,
  }
}

function cosineSimilarity(
  a: Map<number, number>,
  b: Map<number, number>
): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const [key, value] of a) {
    normA += value * value
    const other = b.get(key)
    if (other !== undefined) dot += value * other
  }

  for (const value of b.values()) {
    normB += value * value
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

function buildClustersFromIndex(
  k = Math.max(1, Math.min(10, Math.round(Math.sqrt(searchIndex.totalDocuments / 2)) || 1))
): BookmarkCluster[] {
  const docs = Array.from(searchIndex.bookmarks.entries())
  if (docs.length === 0) return []
  if (docs.length <= 3) {
    return docs.map(([bookmarkId, bookmark], index) => ({
      id: `cluster-${index}`,
      label: bookmark.topTerms.slice(0, 2).join(' · ') || bookmark.domain || bookmark.title,
      keywords: bookmark.topTerms.slice(0, 5),
      bookmarkIds: [bookmarkId],
      size: 1,
    }))
  }

  const significantTerms = Array.from(searchIndex.documentFrequency.entries())
    .filter(([, df]) => df >= 2 && df <= searchIndex.totalDocuments * 0.85)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([term]) => term)

  if (significantTerms.length === 0) return []

  const termIndex = new Map(significantTerms.map((term, index) => [term, index]))
  const vectors = new Map<string, Map<number, number>>()

  for (const [bookmarkId, bookmark] of docs) {
    const vector = new Map<number, number>()
    for (const [term, tf] of bookmark.tfVector) {
      const index = termIndex.get(term)
      if (index === undefined) continue

      const df = searchIndex.documentFrequency.get(term) || 1
      const idf = Math.log(searchIndex.totalDocuments / df)
      vector.set(index, tf * idf)
    }
    vectors.set(bookmarkId, vector)
  }

  const initialCentroidIds = docs
    .slice()
    .sort((a, b) => b[1].topTerms.length - a[1].topTerms.length)
    .slice(0, Math.min(k, docs.length))
    .map(([bookmarkId]) => bookmarkId)

  const centroids = initialCentroidIds.map((bookmarkId) => new Map(vectors.get(bookmarkId)))
  const assignments = new Array(docs.length).fill(0)

  for (let iteration = 0; iteration < 12; iteration++) {
    let changed = false

    for (let docIndex = 0; docIndex < docs.length; docIndex++) {
      const [bookmarkId] = docs[docIndex]
      const vector = vectors.get(bookmarkId) || new Map()
      let bestCluster = 0
      let bestSimilarity = -1

      for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex++) {
        const similarity = cosineSimilarity(vector, centroids[centroidIndex])
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity
          bestCluster = centroidIndex
        }
      }

      if (assignments[docIndex] !== bestCluster) {
        assignments[docIndex] = bestCluster
        changed = true
      }
    }

    if (!changed && iteration > 0) break

    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex++) {
      const members = docs
        .filter((_, docIndex) => assignments[docIndex] === centroidIndex)
        .map(([bookmarkId]) => bookmarkId)

      if (members.length === 0) continue

      const nextCentroid = new Map<number, number>()
      for (const bookmarkId of members) {
        const vector = vectors.get(bookmarkId) || new Map()
        for (const [termId, value] of vector) {
          nextCentroid.set(termId, (nextCentroid.get(termId) || 0) + value)
        }
      }

      for (const [termId, value] of nextCentroid) {
        nextCentroid.set(termId, value / members.length)
      }

      centroids[centroidIndex] = nextCentroid
    }
  }

  const clusters: BookmarkCluster[] = centroids
    .map((centroid, centroidIndex) => {
      const bookmarkIds = docs
        .filter((_, docIndex) => assignments[docIndex] === centroidIndex)
        .map(([bookmarkId]) => bookmarkId)

      if (bookmarkIds.length === 0) return null

      const topTerms = Array.from(centroid.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([termId]) => significantTerms[termId])
        .filter(Boolean)

      const label =
        topTerms
          .slice(0, 2)
          .map((term) => term[0].toUpperCase() + term.slice(1))
          .join(' · ') ||
        searchIndex.bookmarks.get(bookmarkIds[0])?.domain ||
        'Misc'

      return {
        id: `cluster-${centroidIndex}`,
        label,
        keywords: topTerms,
        bookmarkIds,
        size: bookmarkIds.length,
      }
    })
    .filter((cluster): cluster is BookmarkCluster => Boolean(cluster))
    .sort((a, b) => b.size - a.size)

  return clusters
}

function assignClustersToIndex(): void {
  const clusters = buildClustersFromIndex()
  const clusterMap = new Map<string, BookmarkCluster>()

  for (const cluster of clusters) {
    for (const bookmarkId of cluster.bookmarkIds) {
      clusterMap.set(bookmarkId, cluster)
    }
  }

  for (const bookmark of searchIndex.bookmarks.values()) {
    const cluster = clusterMap.get(bookmark.chromeId)
    bookmark.clusterId = cluster?.id
    bookmark.clusterLabel = cluster?.label
    bookmark.clusterKeywords = cluster?.keywords
  }
}

export function clusterBookmarks(k?: number): BookmarkCluster[] {
  return buildClustersFromIndex(k)
}

export function getIndexedBookmarks(): IndexedBookmark[] {
  return Array.from(searchIndex.bookmarks.values())
}

export function getIndexStats() {
  return {
    totalDocuments: searchIndex.totalDocuments,
    totalTerms: searchIndex.invertedIndex.size,
    avgDocLength: Math.round(searchIndex.avgDocLength),
    lastUpdated: searchIndex.lastUpdated,
    indexedUrls: Array.from(searchIndex.bookmarks.values()).filter(
      (bookmark) => bookmark.pageContent.length > 0
    ).length,
    clusters: clusterBookmarks().filter((cluster) => cluster.size > 1).length,
  }
}
