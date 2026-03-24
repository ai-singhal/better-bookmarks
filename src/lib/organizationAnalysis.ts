import { clusterBookmarks, ensureIndex, type BookmarkCluster } from './localSearchEngine'
import { flattenBookmarks, getBookmarkTree } from '../shared/chromeApi'
import type { BookmarkWithMetadata } from '../shared/types'
import { getDomain } from '../shared/utils'

interface FolderRecord {
  id: string
  title: string
  path: string
  parentId?: string
  index: number
  directBookmarks: BookmarkWithMetadata[]
  descendantBookmarks: BookmarkWithMetadata[]
  domainCounts: Map<string, number>
  keywordCounts: Map<string, number>
}

interface HistorySiteRecord {
  domain: string
  url: string
  title: string
  visitCount: number
  typedCount: number
  totalScore: number
  lastVisitTime: number
}

export interface BookmarkMoveSuggestion {
  id: string
  bookmark: BookmarkWithMetadata
  currentFolderPath: string
  currentFolderId: string
  suggestedFolderPath: string
  suggestedFolderId: string
  reason: string
  confidence: number
  historyVisitCount: number
}

export interface HistoryBookmarkSuggestion {
  id: string
  domain: string
  title: string
  url: string
  visitCount: number
  lastVisitTime: number
  suggestedFolderId: string | null
  suggestedFolderPath: string | null
  reason: string
  confidence: number
}

export interface ReorganizationRecommendation {
  id: string
  type: 'rename-folder' | 'reorder-folder' | 'create-folder' | 'delete-folder'
  title: string
  description: string
  confidence: number
  folderId?: string
  folderPath?: string
  suggestedName?: string
  historyVisitCount?: number
}

export interface DuplicateBookmarkInfo {
  url: string
  title: string
  folders: string[]
}

export interface EmptyFolderInfo {
  id: string
  path: string
}

export interface OrganizationAnalysisResult {
  timeframeDays: number
  totalBookmarks: number
  historySitesAnalyzed: number
  clusters: BookmarkCluster[]
  clusterBookmarkMap: Map<string, BookmarkWithMetadata>
  moveSuggestions: BookmarkMoveSuggestion[]
  historySuggestions: HistoryBookmarkSuggestion[]
  recommendations: ReorganizationRecommendation[]
  emptyFolders: EmptyFolderInfo[]
  duplicates: DuplicateBookmarkInfo[]
}

const GENERIC_FOLDER_NAMES = new Set([
  'bookmarks',
  'bookmark',
  'other',
  'other bookmarks',
  'misc',
  'miscellaneous',
  'links',
  'stuff',
  'new folder',
  'untitled',
  'saved',
  'reading',
])

const DOMAIN_NAME_OVERRIDES: Record<string, string> = {
  github: 'GitHub',
  youtube: 'YouTube',
  figma: 'Figma',
  reddit: 'Reddit',
  notion: 'Notion',
  x: 'X',
  twitter: 'Twitter',
  linkedin: 'LinkedIn',
  stackoverflow: 'Stack Overflow',
}

function normalizeDomain(url: string): string {
  return getDomain(url).replace(/^www\./, '').toLowerCase()
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function prettyDomainName(domain: string): string {
  const root = domain.split('.')[0] || domain
  return DOMAIN_NAME_OVERRIDES[root] || toTitleCase(root)
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + amount)
}

function getTopEntry(map: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null
  for (const entry of map.entries()) {
    if (!best || entry[1] > best[1]) best = entry
  }
  return best
}

function buildFolderRecords(nodes: BookmarkWithMetadata[]) {
  const folderMap = new Map<string, FolderRecord>()
  const emptyFolders: EmptyFolderInfo[] = []
  const urlMap = new Map<string, { title: string; folders: string[] }>()

  function walk(node: BookmarkWithMetadata, path: string, parentId?: string): BookmarkWithMetadata[] {
    if (node.url) {
      return [node]
    }

    const folderPath = path ? `${path} / ${node.title}` : node.title
    const children = node.children || []
    const directBookmarks = children.filter((child) => child.url)
    const descendantBookmarks: BookmarkWithMetadata[] = []

    for (const child of children) {
      descendantBookmarks.push(...walk(child, folderPath, node.id))
    }

    const domainCounts = new Map<string, number>()
    const keywordCounts = new Map<string, number>()

    for (const bookmark of descendantBookmarks) {
      if (!bookmark.url) continue
      const domain = normalizeDomain(bookmark.url)
      increment(domainCounts, domain)
      for (const token of tokenize(bookmark.title)) {
        increment(keywordCounts, token)
      }
    }

    for (const token of tokenize(node.title)) {
      increment(keywordCounts, token, 2)
    }

    for (const bookmark of directBookmarks) {
      if (!bookmark.url) continue
      const existing = urlMap.get(bookmark.url)
      if (existing) {
        existing.folders.push(folderPath)
      } else {
        urlMap.set(bookmark.url, { title: bookmark.title, folders: [folderPath] })
      }
    }

    folderMap.set(node.id, {
      id: node.id,
      title: node.title,
      path: folderPath,
      parentId,
      index: node.index ?? 0,
      directBookmarks,
      descendantBookmarks,
      domainCounts,
      keywordCounts,
    })

    if (children.length === 0) {
      emptyFolders.push({ id: node.id, path: folderPath })
    }

    return descendantBookmarks
  }

  for (const node of nodes) {
    walk(node, '')
  }

  const duplicates = [...urlMap.entries()]
    .filter(([, info]) => info.folders.length > 1)
    .map(([url, info]) => ({ url, title: info.title, folders: info.folders }))

  return { folderMap, emptyFolders, duplicates }
}

function chooseBestFolder(
  site: HistorySiteRecord,
  folderMap: Map<string, FolderRecord>
): { folder: FolderRecord; score: number; reason: string } | null {
  const domainRoot = site.domain.split('.')[0]
  const titleTokens = tokenize(site.title)
  let best: { folder: FolderRecord; score: number; reason: string } | null = null

  for (const folder of folderMap.values()) {
    if (folder.descendantBookmarks.length === 0) continue

    let score = 0
    const reasons: string[] = []
    const sameDomainCount = folder.domainCounts.get(site.domain) || 0

    if (sameDomainCount > 0) {
      score += 6 + sameDomainCount * 2
      reasons.push(`${folder.title} already contains ${sameDomainCount} ${site.domain} bookmark${sameDomainCount > 1 ? 's' : ''}`)
    }

    const folderTokens = new Set(tokenize(folder.title))
    if (folderTokens.has(domainRoot)) {
      score += 4
      reasons.push(`the folder name matches ${prettyDomainName(site.domain)}`)
    }

    let keywordHits = 0
    for (const token of titleTokens) {
      keywordHits += folder.keywordCounts.get(token) || 0
    }
    if (keywordHits > 0) {
      score += Math.min(4, keywordHits)
      reasons.push(`its bookmark titles overlap with "${site.title}"`)
    }

    if (!best || score > best.score) {
      best = {
        folder,
        score,
        reason: reasons[0] || `it is the closest folder match for ${prettyDomainName(site.domain)}`,
      }
    }
  }

  return best && best.score >= 4 ? best : null
}

function isGenericFolderTitle(title: string): boolean {
  return GENERIC_FOLDER_NAMES.has(title.trim().toLowerCase())
}

function getHistoryWindowStart(timeframeDays: number): number {
  return Date.now() - timeframeDays * 24 * 60 * 60 * 1000
}

async function getHistorySites(timeframeDays: number): Promise<HistorySiteRecord[]> {
  const historyItems = await chrome.history.search({
    text: '',
    startTime: getHistoryWindowStart(timeframeDays),
    maxResults: 3000,
  })

  const grouped = new Map<string, HistorySiteRecord>()

  for (const item of historyItems) {
    if (!item.url || !/^https?:\/\//.test(item.url)) continue

    const domain = normalizeDomain(item.url)
    if (!domain) continue

    const visitCount = item.visitCount || 0
    const typedCount = item.typedCount || 0
    const score = Math.max(1, visitCount + typedCount * 2)
    const lastVisitTime = item.lastVisitTime || 0
    const title = item.title || prettyDomainName(domain)

    const existing = grouped.get(domain)
    if (!existing) {
      grouped.set(domain, {
        domain,
        url: item.url,
        title,
        visitCount,
        typedCount,
        totalScore: score,
        lastVisitTime,
      })
      continue
    }

    existing.visitCount += visitCount
    existing.typedCount += typedCount
    existing.totalScore += score
    existing.lastVisitTime = Math.max(existing.lastVisitTime, lastVisitTime)

    const existingScore = existing.visitCount + existing.typedCount
    const currentScore = visitCount + typedCount
    if (currentScore > existingScore || lastVisitTime > existing.lastVisitTime) {
      existing.url = item.url
      existing.title = title
    }
  }

  return [...grouped.values()].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore
    return b.lastVisitTime - a.lastVisitTime
  })
}

function buildMoveSuggestions(
  folderMap: Map<string, FolderRecord>,
  bookmarks: BookmarkWithMetadata[],
  historyByDomain: Map<string, HistorySiteRecord>,
  timeframeDays: number
): BookmarkMoveSuggestion[] {
  const suggestions: BookmarkMoveSuggestion[] = []
  let suggestionId = 0

  for (const bookmark of bookmarks) {
    if (!bookmark.url || !bookmark.parentId) continue

    const domain = normalizeDomain(bookmark.url)
    const currentFolder = folderMap.get(bookmark.parentId)
    if (!currentFolder) continue

    const currentDomainCount = currentFolder.domainCounts.get(domain) || 0
    const currentRatio = currentFolder.descendantBookmarks.length > 0
      ? currentDomainCount / currentFolder.descendantBookmarks.length
      : 0

    let bestFolder: FolderRecord | null = null
    let bestScore = 0

    for (const folder of folderMap.values()) {
      if (folder.id === currentFolder.id) continue
      const domainCount = folder.domainCounts.get(domain) || 0
      if (domainCount === 0) continue

      const ratio = folder.descendantBookmarks.length > 0
        ? domainCount / folder.descendantBookmarks.length
        : 0

      const historyBoost = (historyByDomain.get(domain)?.visitCount || 0) / 25
      const score = ratio + Math.min(0.3, historyBoost)

      if (domainCount >= 2 && score > bestScore) {
        bestScore = score
        bestFolder = folder
      }
    }

    if (!bestFolder) continue
    if (currentDomainCount > 1 || currentRatio >= 0.25) continue

    const historyVisits = historyByDomain.get(domain)?.visitCount || 0
    let reason = `"${bestFolder.title}" already groups ${domain} links more consistently`
    if (historyVisits > 0) {
      reason += `, and you visited ${prettyDomainName(domain)} ${historyVisits} times in the last ${timeframeDays} days`
    }

    suggestions.push({
      id: `move-${suggestionId++}`,
      bookmark,
      currentFolderPath: currentFolder.path,
      currentFolderId: currentFolder.id,
      suggestedFolderPath: bestFolder.path,
      suggestedFolderId: bestFolder.id,
      reason,
      confidence: Math.min(0.97, bestScore),
      historyVisitCount: historyVisits,
    })
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 40)
}

function buildHistorySuggestions(
  historySites: HistorySiteRecord[],
  folderMap: Map<string, FolderRecord>,
  exactBookmarkedUrls: Set<string>,
  timeframeDays: number
): HistoryBookmarkSuggestion[] {
  const suggestions: HistoryBookmarkSuggestion[] = []
  let suggestionId = 0

  for (const site of historySites) {
    if (exactBookmarkedUrls.has(site.url)) continue
    if (site.visitCount < 3) continue

    const bestFolder = chooseBestFolder(site, folderMap)

    suggestions.push({
      id: `history-${suggestionId++}`,
      domain: site.domain,
      title: site.title || prettyDomainName(site.domain),
      url: site.url,
      visitCount: site.visitCount,
      lastVisitTime: site.lastVisitTime,
      suggestedFolderId: bestFolder?.folder.id || null,
      suggestedFolderPath: bestFolder?.folder.path || null,
      reason: bestFolder
        ? `You visited ${prettyDomainName(site.domain)} ${site.visitCount} times in the last ${timeframeDays} days, and ${bestFolder.reason}.`
        : `You visited ${prettyDomainName(site.domain)} ${site.visitCount} times in the last ${timeframeDays} days, but there is no strong folder match yet.`,
      confidence: bestFolder
        ? Math.min(0.96, 0.45 + bestFolder.score / 20)
        : 0.45,
    })
  }

  return suggestions.slice(0, 20)
}

function buildRecommendations(
  folderMap: Map<string, FolderRecord>,
  rootNodes: BookmarkWithMetadata[],
  historyByDomain: Map<string, HistorySiteRecord>,
  historySuggestions: HistoryBookmarkSuggestion[],
  emptyFolders: EmptyFolderInfo[],
  timeframeDays: number
): ReorganizationRecommendation[] {
  const recommendations: ReorganizationRecommendation[] = []
  let recommendationId = 0

  for (const folder of folderMap.values()) {
    if (folder.descendantBookmarks.length < 2) continue

    const topDomain = getTopEntry(folder.domainCounts)
    if (!topDomain) continue

    const [domain, count] = topDomain
    const dominance = count / folder.descendantBookmarks.length
    const historyVisits = historyByDomain.get(domain)?.visitCount || 0
    const folderName = folder.title.trim()
    const suggestedName = prettyDomainName(domain)

    if (
      suggestedName.toLowerCase() !== folderName.toLowerCase() &&
      (isGenericFolderTitle(folderName) || (dominance >= 0.65 && historyVisits >= 3))
    ) {
      recommendations.push({
        id: `rec-${recommendationId++}`,
        type: 'rename-folder',
        title: `Rename "${folder.title}" to "${suggestedName}"`,
        description: `${suggestedName} dominates this folder (${count} of ${folder.descendantBookmarks.length} bookmarks), and the same site appears frequently in recent browsing history.`,
        confidence: Math.min(0.95, 0.55 + dominance / 2 + Math.min(0.15, historyVisits / 40)),
        folderId: folder.id,
        folderPath: folder.path,
        suggestedName,
        historyVisitCount: historyVisits,
      })
    }
  }

  const rootFolders = rootNodes
    .filter((node) => !node.url && node.children)
    .map((node) => folderMap.get(node.id))
    .filter((folder): folder is FolderRecord => Boolean(folder))

  const activityScore = (folder: FolderRecord) => {
    let score = 0
    for (const [domain, count] of folder.domainCounts.entries()) {
      const visits = historyByDomain.get(domain)?.visitCount || 0
      score += visits * Math.min(3, count)
    }
    return score
  }

  const sortedByActivity = [...rootFolders]
    .map((folder) => ({ folder, score: activityScore(folder) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  for (const [recommendedIndex, entry] of sortedByActivity.entries()) {
    const currentIndex = entry.folder.index
    if (recommendedIndex >= currentIndex || currentIndex - recommendedIndex < 2) continue

    recommendations.push({
      id: `rec-${recommendationId++}`,
      type: 'reorder-folder',
      title: `Move "${entry.folder.title}" closer to the top`,
      description: `Bookmarks in this folder line up with ${entry.score} recent history signals, so it should likely sit above lower-traffic folders.`,
      confidence: Math.min(0.9, 0.45 + entry.score / 120),
      folderId: entry.folder.id,
      folderPath: entry.folder.path,
      historyVisitCount: entry.score,
    })
  }

  const createFolderSuggestions = historySuggestions
    .filter((suggestion) => !suggestion.suggestedFolderId && suggestion.visitCount >= 5)
    .slice(0, 5)

  for (const suggestion of createFolderSuggestions) {
    const suggestedName = prettyDomainName(suggestion.domain)
    recommendations.push({
      id: `rec-${recommendationId++}`,
      type: 'create-folder',
      title: `Create a folder for "${suggestedName}"`,
      description: `You keep returning to ${suggestedName} (${suggestion.visitCount} visits in the last ${timeframeDays} days), but there is no existing folder that clearly fits it.`,
      confidence: Math.min(0.85, 0.45 + suggestion.visitCount / 20),
      suggestedName,
      historyVisitCount: suggestion.visitCount,
    })
  }

  for (const emptyFolder of emptyFolders.slice(0, 8)) {
    recommendations.push({
      id: `rec-${recommendationId++}`,
      type: 'delete-folder',
      title: `Delete empty folder "${emptyFolder.path}"`,
      description: 'It has no bookmarks and is only adding noise to the current structure.',
      confidence: 0.95,
      folderId: emptyFolder.id,
      folderPath: emptyFolder.path,
    })
  }

  return recommendations
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 18)
}

export async function analyzeOrganization(timeframeDays: number): Promise<OrganizationAnalysisResult> {
  const tree = await getBookmarkTree()
  const rootNodes = tree[0]?.children || []
  const flatBookmarks = flattenBookmarks(tree)

  const exactBookmarkedUrls = new Set(
    flatBookmarks.map((bookmark) => bookmark.url).filter((url): url is string => Boolean(url))
  )

  const { folderMap, emptyFolders, duplicates } = buildFolderRecords(rootNodes)
  const historySites = await getHistorySites(timeframeDays)
  const historyByDomain = new Map(historySites.map((site) => [site.domain, site]))

  await ensureIndex(flatBookmarks)
  const clusters = clusterBookmarks().filter((cluster) => cluster.size > 1).slice(0, 12)
  const clusterBookmarkMap = new Map(flatBookmarks.map((bookmark) => [bookmark.id, bookmark]))

  const moveSuggestions = buildMoveSuggestions(folderMap, flatBookmarks, historyByDomain, timeframeDays)
  const historySuggestions = buildHistorySuggestions(historySites, folderMap, exactBookmarkedUrls, timeframeDays)
  const recommendations = buildRecommendations(
    folderMap,
    rootNodes,
    historyByDomain,
    historySuggestions,
    emptyFolders,
    timeframeDays
  )

  return {
    timeframeDays,
    totalBookmarks: flatBookmarks.length,
    historySitesAnalyzed: historySites.length,
    clusters,
    clusterBookmarkMap,
    moveSuggestions,
    historySuggestions,
    recommendations,
    emptyFolders,
    duplicates,
  }
}
