// Local AI search engine using TF-IDF vectorization + BM25 scoring
// Works entirely client-side without API keys
// Persists index to chrome.storage.local for fast startup

import type { BookmarkWithMetadata } from '../shared/types'
import { parsePage, type ParsedPage } from './pageParser'
import { parseQuery, getExpandedTerms, type ParsedQuery, type TimeFilter } from './queryParser'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndexedBookmark {
  chromeId: string
  url: string
  title: string
  dateAdded: number
  parentId?: string
  // Enrichment
  pageContent: string    // Extracted page text
  userNote: string       // User's reason for bookmarking
  tags: string[]
  domain: string
  // Derived
  tokens: string[]       // Tokenized terms for this bookmark
  tfVector: Map<string, number> // term -> tf score
}

export interface SearchResult {
  bookmark: BookmarkWithMetadata
  score: number
  matchReasons: string[]
  highlights: string[] // Matched terms
}

export interface SearchIndex {
  bookmarks: Map<string, IndexedBookmark>       // chromeId -> indexed data
  invertedIndex: Map<string, Set<string>>        // term -> set of chromeIds
  documentFrequency: Map<string, number>         // term -> number of docs containing it
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

// ─── Tokenizer ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'it', 'that', 'this', 'was', 'are', 'be', 'has',
  'had', 'have', 'been', 'will', 'can', 'do', 'does', 'did', 'not', 'no',
  'so', 'if', 'as', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'she', 'his', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  'when', 'where', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\-./]/g, ' ')
    .split(/[\s\-_./]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

// Simple stemmer (suffix stripping)
function stem(word: string): string {
  if (word.length < 4) return word
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y'
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

// ─── TF-IDF Computation ─────────────────────────────────────────────────────

function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1)
  }
  // Normalize by document length
  const length = tokens.length || 1
  for (const [term, count] of tf) {
    tf.set(term, count / length)
  }
  return tf
}

// ─── BM25 Scoring ────────────────────────────────────────────────────────────

const BM25_K1 = 1.5 // Term frequency saturation
const BM25_B = 0.75  // Length normalization

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  docTF: Map<string, number>,
  documentFrequency: Map<string, number>,
  totalDocs: number,
  avgDocLength: number
): number {
  const docLength = docTokens.length
  let score = 0

  for (const qt of queryTokens) {
    const df = documentFrequency.get(qt) || 0
    if (df === 0) continue

    // IDF component
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1)

    // TF component with BM25 normalization
    const rawTF = (docTF.get(qt) || 0) * docLength // Un-normalize TF
    const tfNorm = (rawTF * (BM25_K1 + 1)) / (rawTF + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength)))

    score += idf * tfNorm
  }

  return score
}

// ─── Index Management ────────────────────────────────────────────────────────

let searchIndex: SearchIndex = {
  bookmarks: new Map(),
  invertedIndex: new Map(),
  documentFrequency: new Map(),
  totalDocuments: 0,
  avgDocLength: 0,
  lastUpdated: 0,
}

const INDEX_STORAGE_KEY = 'search_index_v2'
const NOTES_STORAGE_KEY = 'bookmark_notes'

// Serialize index for chrome.storage
function serializeIndex(index: SearchIndex): string {
  const obj = {
    bookmarks: Array.from(index.bookmarks.entries()).map(([k, v]) => [
      k,
      { ...v, tokens: v.tokens, tfVector: Array.from(v.tfVector.entries()) },
    ]),
    invertedIndex: Array.from(index.invertedIndex.entries()).map(([k, v]) => [k, Array.from(v)]),
    documentFrequency: Array.from(index.documentFrequency.entries()),
    totalDocuments: index.totalDocuments,
    avgDocLength: index.avgDocLength,
    lastUpdated: index.lastUpdated,
  }
  return JSON.stringify(obj)
}

function deserializeIndex(json: string): SearchIndex | null {
  try {
    const obj = JSON.parse(json)
    return {
      bookmarks: new Map(
        obj.bookmarks.map(([k, v]: [string, Record<string, unknown>]) => [
          k,
          { ...v, tfVector: new Map(v.tfVector as [string, number][]) },
        ])
      ),
      invertedIndex: new Map(
        obj.invertedIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)])
      ),
      documentFrequency: new Map(obj.documentFrequency),
      totalDocuments: obj.totalDocuments,
      avgDocLength: obj.avgDocLength,
      lastUpdated: obj.lastUpdated,
    }
  } catch {
    return null
  }
}

export async function loadIndex(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(INDEX_STORAGE_KEY)
    const json = data[INDEX_STORAGE_KEY]
    if (json) {
      const loaded = deserializeIndex(json)
      if (loaded) {
        searchIndex = loaded
        return true
      }
    }
  } catch (err) {
    console.error('[SearchEngine] Failed to load index:', err)
  }
  return false
}

async function saveIndex(): Promise<void> {
  try {
    const json = serializeIndex(searchIndex)
    await chrome.storage.local.set({ [INDEX_STORAGE_KEY]: json })
  } catch (err) {
    console.error('[SearchEngine] Failed to save index:', err)
  }
}

// ─── Notes Storage ───────────────────────────────────────────────────────────

export async function getBookmarkNotes(): Promise<Record<string, string>> {
  const data = await chrome.storage.local.get(NOTES_STORAGE_KEY)
  return (data[NOTES_STORAGE_KEY] as Record<string, string>) || {}
}

export async function setBookmarkNote(chromeId: string, note: string): Promise<void> {
  const notes = await getBookmarkNotes()
  if (note.trim()) {
    notes[chromeId] = note
  } else {
    delete notes[chromeId]
  }
  await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes })

  // Update the index if this bookmark is indexed
  const existing = searchIndex.bookmarks.get(chromeId)
  if (existing) {
    existing.userNote = note
    rebuildSingleDocument(chromeId, existing)
    await saveIndex()
  }
}

export async function getBookmarkNote(chromeId: string): Promise<string> {
  const notes = await getBookmarkNotes()
  return notes[chromeId] || ''
}

// ─── Indexing ────────────────────────────────────────────────────────────────

function buildDocumentText(bookmark: IndexedBookmark): string {
  // Weight title and user notes higher by repeating them
  const parts = [
    bookmark.title, bookmark.title, bookmark.title,  // 3x title weight
    bookmark.userNote, bookmark.userNote, bookmark.userNote,  // 3x note weight
    bookmark.tags.join(' '), bookmark.tags.join(' '),  // 2x tags weight
    bookmark.domain,
    bookmark.pageContent,
  ]
  return parts.filter(Boolean).join(' ')
}

function rebuildSingleDocument(chromeId: string, bookmark: IndexedBookmark): void {
  // Remove old entries from inverted index
  for (const [term, docSet] of searchIndex.invertedIndex) {
    docSet.delete(chromeId)
    if (docSet.size === 0) {
      searchIndex.invertedIndex.delete(term)
    }
  }

  // Recompute tokens
  const docText = buildDocumentText(bookmark)
  const tokens = processTokens(docText)
  bookmark.tokens = tokens
  bookmark.tfVector = computeTF(tokens)

  // Update inverted index
  const uniqueTerms = new Set(tokens)
  for (const term of uniqueTerms) {
    if (!searchIndex.invertedIndex.has(term)) {
      searchIndex.invertedIndex.set(term, new Set())
    }
    searchIndex.invertedIndex.get(term)!.add(chromeId)
  }

  // Recompute document frequency
  searchIndex.documentFrequency.clear()
  for (const [term, docs] of searchIndex.invertedIndex) {
    searchIndex.documentFrequency.set(term, docs.size)
  }

  // Recompute avg doc length
  let totalLength = 0
  for (const [, bm] of searchIndex.bookmarks) {
    totalLength += bm.tokens.length
  }
  searchIndex.avgDocLength = totalLength / (searchIndex.totalDocuments || 1)
}

export async function indexBookmarks(
  bookmarks: BookmarkWithMetadata[],
  onProgress?: (progress: IndexingProgress) => void
): Promise<void> {
  const notes = await getBookmarkNotes()
  const urlBookmarks = bookmarks.filter((b) => b.url)
  const total = urlBookmarks.length

  onProgress?.({ phase: 'fetching', current: 0, total })

  // Phase 1: Parse pages (only for new/unindexed bookmarks)
  const toFetch: string[] = []
  for (const b of urlBookmarks) {
    if (!searchIndex.bookmarks.has(b.id) || !searchIndex.bookmarks.get(b.id)?.pageContent) {
      if (b.url) toFetch.push(b.url)
    }
  }

  const parsedPages = new Map<string, ParsedPage>()
  let fetched = 0

  // Fetch in batches of 5
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const page = await parsePage(url)
        if (page) parsedPages.set(url, page)
        fetched++
        onProgress?.({ phase: 'parsing', current: fetched, total: toFetch.length, currentUrl: url })
      })
    )
    // Ignore individual failures
    void results
  }

  // Phase 2: Build index
  onProgress?.({ phase: 'indexing', current: 0, total })

  const newIndex: SearchIndex = {
    bookmarks: new Map(),
    invertedIndex: new Map(),
    documentFrequency: new Map(),
    totalDocuments: 0,
    avgDocLength: 0,
    lastUpdated: Date.now(),
  }

  let totalTokenLength = 0

  for (let i = 0; i < urlBookmarks.length; i++) {
    const b = urlBookmarks[i]
    if (!b.url) continue

    const existing = searchIndex.bookmarks.get(b.id)
    const parsed = parsedPages.get(b.url)
    const pageContent = parsed?.fullText || existing?.pageContent || ''
    const domain = parsed?.domain || (b.url ? new URL(b.url).hostname.replace('www.', '') : '')

    const indexed: IndexedBookmark = {
      chromeId: b.id,
      url: b.url,
      title: b.title || '',
      dateAdded: b.dateAdded || Date.now(),
      parentId: b.parentId,
      pageContent,
      userNote: notes[b.id] || existing?.userNote || '',
      tags: existing?.tags || [],
      domain,
      tokens: [],
      tfVector: new Map(),
    }

    // Tokenize
    const docText = buildDocumentText(indexed)
    const tokens = processTokens(docText)
    indexed.tokens = tokens
    indexed.tfVector = computeTF(tokens)
    totalTokenLength += tokens.length

    newIndex.bookmarks.set(b.id, indexed)

    // Build inverted index
    const uniqueTerms = new Set(tokens)
    for (const term of uniqueTerms) {
      if (!newIndex.invertedIndex.has(term)) {
        newIndex.invertedIndex.set(term, new Set())
      }
      newIndex.invertedIndex.get(term)!.add(b.id)
    }

    if (i % 50 === 0) {
      onProgress?.({ phase: 'indexing', current: i, total })
    }
  }

  // Compute document frequency
  for (const [term, docs] of newIndex.invertedIndex) {
    newIndex.documentFrequency.set(term, docs.size)
  }

  newIndex.totalDocuments = newIndex.bookmarks.size
  newIndex.avgDocLength = totalTokenLength / (newIndex.totalDocuments || 1)

  searchIndex = newIndex
  await saveIndex()
  onProgress?.({ phase: 'done', current: total, total })
}

// Index a single bookmark (for real-time updates)
export async function indexSingleBookmark(bookmark: BookmarkWithMetadata): Promise<void> {
  if (!bookmark.url) return

  const notes = await getBookmarkNotes()
  const parsed = await parsePage(bookmark.url)
  const domain = bookmark.url ? new URL(bookmark.url).hostname.replace('www.', '') : ''

  const indexed: IndexedBookmark = {
    chromeId: bookmark.id,
    url: bookmark.url,
    title: bookmark.title || '',
    dateAdded: bookmark.dateAdded || Date.now(),
    parentId: bookmark.parentId,
    pageContent: parsed?.fullText || '',
    userNote: notes[bookmark.id] || '',
    tags: [],
    domain,
    tokens: [],
    tfVector: new Map(),
  }

  const docText = buildDocumentText(indexed)
  indexed.tokens = processTokens(docText)
  indexed.tfVector = computeTF(indexed.tokens)

  searchIndex.bookmarks.set(bookmark.id, indexed)
  searchIndex.totalDocuments = searchIndex.bookmarks.size

  // Update inverted index
  const uniqueTerms = new Set(indexed.tokens)
  for (const term of uniqueTerms) {
    if (!searchIndex.invertedIndex.has(term)) {
      searchIndex.invertedIndex.set(term, new Set())
    }
    searchIndex.invertedIndex.get(term)!.add(bookmark.id)
    searchIndex.documentFrequency.set(term, searchIndex.invertedIndex.get(term)!.size)
  }

  // Recompute avg doc length
  let totalLength = 0
  for (const [, bm] of searchIndex.bookmarks) {
    totalLength += bm.tokens.length
  }
  searchIndex.avgDocLength = totalLength / searchIndex.totalDocuments

  await saveIndex()
}

export function removeFromIndex(chromeId: string): void {
  const bookmark = searchIndex.bookmarks.get(chromeId)
  if (!bookmark) return

  // Remove from inverted index
  const uniqueTerms = new Set(bookmark.tokens)
  for (const term of uniqueTerms) {
    const docSet = searchIndex.invertedIndex.get(term)
    if (docSet) {
      docSet.delete(chromeId)
      if (docSet.size === 0) {
        searchIndex.invertedIndex.delete(term)
        searchIndex.documentFrequency.delete(term)
      } else {
        searchIndex.documentFrequency.set(term, docSet.size)
      }
    }
  }

  searchIndex.bookmarks.delete(chromeId)
  searchIndex.totalDocuments = searchIndex.bookmarks.size
}

// ─── Search ──────────────────────────────────────────────────────────────────

function applyTimeFilter(results: SearchResult[], timeFilter: TimeFilter): SearchResult[] {
  return results.filter((r) => {
    const added = r.bookmark.dateAdded || 0
    return added >= timeFilter.after && added <= timeFilter.before
  })
}

export function search(query: string, limit = 50): { results: SearchResult[]; parsedQuery: ParsedQuery } {
  const parsedQuery = parseQuery(query)

  if (!parsedQuery.searchTerms && !parsedQuery.timeFilter) {
    return { results: [], parsedQuery }
  }

  let results: SearchResult[]

  if (!parsedQuery.searchTerms && parsedQuery.timeFilter) {
    // Time-only query: return all bookmarks in time range, sorted by date
    results = []
    for (const [, indexed] of searchIndex.bookmarks) {
      const added = indexed.dateAdded || 0
      if (added >= parsedQuery.timeFilter.after && added <= parsedQuery.timeFilter.before) {
        results.push({
          bookmark: {
            id: indexed.chromeId,
            parentId: indexed.parentId,
            title: indexed.title,
            url: indexed.url,
            dateAdded: indexed.dateAdded,
          },
          score: indexed.dateAdded, // Sort by recency
          matchReasons: [`Added ${new Date(indexed.dateAdded).toLocaleDateString()}`],
          highlights: [],
        })
      }
    }
    results.sort((a, b) => b.score - a.score)
    return { results: results.slice(0, limit), parsedQuery }
  }

  // Get expanded search terms for better recall
  const expandedTerms = getExpandedTerms(parsedQuery.searchTerms)
  const queryTokens = expandedTerms.flatMap((t) => processTokens(t))
  const uniqueQueryTokens = [...new Set(queryTokens)]

  // Find candidate documents via inverted index (fast pre-filter)
  const candidates = new Set<string>()
  for (const qt of uniqueQueryTokens) {
    const docs = searchIndex.invertedIndex.get(qt)
    if (docs) {
      for (const docId of docs) candidates.add(docId)
    }
  }

  // Score candidates with BM25
  results = []
  for (const docId of candidates) {
    const indexed = searchIndex.bookmarks.get(docId)
    if (!indexed) continue

    const score = bm25Score(
      uniqueQueryTokens,
      indexed.tokens,
      indexed.tfVector,
      searchIndex.documentFrequency,
      searchIndex.totalDocuments,
      searchIndex.avgDocLength
    )

    if (score > 0) {
      // Determine match reasons
      const matchReasons: string[] = []
      const highlights: string[] = []

      const titleLower = indexed.title.toLowerCase()
      const noteLower = indexed.userNote.toLowerCase()
      const searchLower = parsedQuery.searchTerms.toLowerCase()
      const searchWords = searchLower.split(/\s+/)

      for (const word of searchWords) {
        if (titleLower.includes(word)) highlights.push(word)
      }

      if (searchWords.some((w) => titleLower.includes(w))) matchReasons.push('Title match')
      if (searchWords.some((w) => noteLower.includes(w))) matchReasons.push('Note match')
      if (searchWords.some((w) => indexed.domain.includes(w))) matchReasons.push('Domain match')
      if (searchWords.some((w) => indexed.tags.some((t) => t.toLowerCase().includes(w)))) matchReasons.push('Tag match')
      if (searchWords.some((w) => indexed.pageContent.toLowerCase().includes(w))) matchReasons.push('Content match')

      // Boost for user notes matches
      let boostedScore = score
      if (matchReasons.includes('Note match')) boostedScore *= 1.5
      if (matchReasons.includes('Title match')) boostedScore *= 1.3

      results.push({
        bookmark: {
          id: indexed.chromeId,
          parentId: indexed.parentId,
          title: indexed.title,
          url: indexed.url,
          dateAdded: indexed.dateAdded,
        },
        score: boostedScore,
        matchReasons,
        highlights,
      })
    }
  }

  // Apply time filter if present
  if (parsedQuery.timeFilter) {
    results = applyTimeFilter(results, parsedQuery.timeFilter)
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score)

  return { results: results.slice(0, limit), parsedQuery }
}

// ─── Clustering ──────────────────────────────────────────────────────────────

export interface BookmarkCluster {
  id: number
  label: string
  keywords: string[]
  bookmarkIds: string[]
  size: number
}

export function clusterBookmarks(k = 8): BookmarkCluster[] {
  const docs = Array.from(searchIndex.bookmarks.entries())
  if (docs.length < k) k = Math.max(1, Math.floor(docs.length / 2))
  if (docs.length === 0) return []

  // Get all terms that appear in at least 2 documents (for efficiency)
  const significantTerms = new Map<string, number>()
  for (const [term, df] of searchIndex.documentFrequency) {
    if (df >= 2 && df <= searchIndex.totalDocuments * 0.8) {
      significantTerms.set(term, df)
    }
  }

  const termList = Array.from(significantTerms.keys())
  if (termList.length === 0) return []

  // Build TF-IDF vectors (sparse, using term indices)
  const vectors: Map<string, Map<number, number>> = new Map()
  for (const [id, indexed] of docs) {
    const vec = new Map<number, number>()
    for (let ti = 0; ti < termList.length; ti++) {
      const term = termList[ti]
      const tf = indexed.tfVector.get(term) || 0
      if (tf > 0) {
        const df = significantTerms.get(term) || 1
        const idf = Math.log(searchIndex.totalDocuments / df)
        vec.set(ti, tf * idf)
      }
    }
    vectors.set(id, vec)
  }

  // K-means clustering
  const docIds = docs.map(([id]) => id)

  // Initialize centroids randomly
  const shuffled = [...docIds].sort(() => Math.random() - 0.5)
  const centroids: Map<number, number>[] = shuffled.slice(0, k).map((id) => {
    const vec = vectors.get(id)!
    return new Map(vec)
  })

  const assignments = new Array<number>(docIds.length).fill(0)
  const MAX_ITERATIONS = 20

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false

    // Assign each document to nearest centroid
    for (let di = 0; di < docIds.length; di++) {
      const vec = vectors.get(docIds[di])!
      let bestCluster = 0
      let bestSim = -1

      for (let ci = 0; ci < centroids.length; ci++) {
        const sim = cosineSimilarity(vec, centroids[ci])
        if (sim > bestSim) {
          bestSim = sim
          bestCluster = ci
        }
      }

      if (assignments[di] !== bestCluster) {
        assignments[di] = bestCluster
        changed = true
      }
    }

    if (!changed) break

    // Recompute centroids
    for (let ci = 0; ci < centroids.length; ci++) {
      const members = docIds.filter((_, di) => assignments[di] === ci)
      if (members.length === 0) continue

      const newCentroid = new Map<number, number>()
      for (const memberId of members) {
        const vec = vectors.get(memberId)!
        for (const [ti, val] of vec) {
          newCentroid.set(ti, (newCentroid.get(ti) || 0) + val)
        }
      }
      // Average
      for (const [ti, val] of newCentroid) {
        newCentroid.set(ti, val / members.length)
      }
      centroids[ci] = newCentroid
    }
  }

  // Build cluster objects
  const clusters: BookmarkCluster[] = []
  for (let ci = 0; ci < centroids.length; ci++) {
    const memberIds = docIds.filter((_, di) => assignments[di] === ci)
    if (memberIds.length === 0) continue

    // Find top keywords for this cluster
    const centroid = centroids[ci]
    const topTerms = Array.from(centroid.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ti]) => termList[ti])

    // Generate a label from top terms
    const label = topTerms.slice(0, 3).join(', ')

    clusters.push({
      id: ci,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      keywords: topTerms,
      bookmarkIds: memberIds,
      size: memberIds.length,
    })
  }

  // Sort by size
  clusters.sort((a, b) => b.size - a.size)
  return clusters
}

function cosineSimilarity(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const [k, v] of a) {
    normA += v * v
    const bv = b.get(k)
    if (bv !== undefined) dot += v * bv
  }
  for (const [, v] of b) normB += v * v

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function getIndexStats() {
  return {
    totalDocuments: searchIndex.totalDocuments,
    totalTerms: searchIndex.invertedIndex.size,
    avgDocLength: Math.round(searchIndex.avgDocLength),
    lastUpdated: searchIndex.lastUpdated,
    indexedUrls: Array.from(searchIndex.bookmarks.values()).filter((b) => b.pageContent.length > 0).length,
  }
}

export function isIndexed(): boolean {
  return searchIndex.totalDocuments > 0
}

export function getIndexedBookmark(chromeId: string): IndexedBookmark | undefined {
  return searchIndex.bookmarks.get(chromeId)
}
