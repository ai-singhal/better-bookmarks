// Natural language query parser
// Extracts temporal filters, intent, and semantic terms from queries like
// "cracked people in ML from last month"

export interface ParsedQuery {
  searchTerms: string
  timeFilter: TimeFilter | null
  intentHints: string[]
  original: string
}

export interface TimeFilter {
  after: number
  before: number
  label: string
}

interface MatchedTimePattern {
  pattern: RegExp
  resolve: (match: RegExpMatchArray) => TimeFilter
}

const DAY_MS = 24 * 60 * 60 * 1000

const TIME_PATTERNS: MatchedTimePattern[] = [
  {
    pattern: /\b(?:from |in |during )?(?:the )?(?:last|past) (\d+) days?\b/i,
    resolve: (match) => {
      const days = Number.parseInt(match[1], 10) || 7
      return {
        after: Date.now() - days * DAY_MS,
        before: Date.now(),
        label: `last ${days} days`,
      }
    },
  },
  {
    pattern: /\b(?:from |in |during )?(?:the )?(?:last|past) (\d+) weeks?\b/i,
    resolve: (match) => {
      const weeks = Number.parseInt(match[1], 10) || 1
      return {
        after: Date.now() - weeks * 7 * DAY_MS,
        before: Date.now(),
        label: `last ${weeks} weeks`,
      }
    },
  },
  {
    pattern: /\b(?:from |in |during )?(?:the )?(?:last|past) (\d+) months?\b/i,
    resolve: (match) => {
      const months = Number.parseInt(match[1], 10) || 1
      const after = new Date()
      after.setMonth(after.getMonth() - months)
      return {
        after: after.getTime(),
        before: Date.now(),
        label: `last ${months} months`,
      }
    },
  },
  {
    pattern: /\b(?:from |in |during )?(?:the )?last week\b/i,
    resolve: () => ({
      after: Date.now() - 7 * DAY_MS,
      before: Date.now(),
      label: 'last week',
    }),
  },
  {
    pattern: /\b(?:from |in |during )?(?:the )?(?:last|past) month\b/i,
    resolve: () => {
      const after = new Date()
      after.setMonth(after.getMonth() - 1)
      return { after: after.getTime(), before: Date.now(), label: 'last month' }
    },
  },
  {
    pattern: /\b(?:from |in |during )?(?:the )?last year\b/i,
    resolve: () => {
      const after = new Date()
      after.setFullYear(after.getFullYear() - 1)
      return { after: after.getTime(), before: Date.now(), label: 'last year' }
    },
  },
  {
    pattern: /\bthis week\b/i,
    resolve: () => {
      const now = new Date()
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      return { after: start.getTime(), before: Date.now(), label: 'this week' }
    },
  },
  {
    pattern: /\bthis month\b/i,
    resolve: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { after: start.getTime(), before: Date.now(), label: 'this month' }
    },
  },
  {
    pattern: /\btoday\b/i,
    resolve: () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      return { after: start.getTime(), before: Date.now(), label: 'today' }
    },
  },
  {
    pattern: /\byesterday\b/i,
    resolve: () => {
      const start = new Date()
      start.setDate(start.getDate() - 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setHours(23, 59, 59, 999)
      return { after: start.getTime(), before: end.getTime(), label: 'yesterday' }
    },
  },
  {
    pattern: /\brecent(?:ly)?\b/i,
    resolve: () => ({
      after: Date.now() - 14 * DAY_MS,
      before: Date.now(),
      label: 'recent',
    }),
  },
]

function parseTimeFilter(
  query: string
): { filter: TimeFilter | null; cleaned: string } {
  for (const { pattern, resolve } of TIME_PATTERNS) {
    const match = query.match(pattern)
    if (!match) continue

    const cleaned = query.replace(match[0], ' ').replace(/\s+/g, ' ').trim()
    return {
      filter: resolve(match),
      cleaned,
    }
  }

  return { filter: null, cleaned: query.trim() }
}

const TERM_EXPANSIONS: Record<string, string[]> = {
  cracked: ['expert', 'talented', 'skilled', 'impressive', 'top', 'best', 'brilliant'],
  goated: ['greatest', 'best', 'legendary', 'elite'],
  fire: ['great', 'amazing', 'excellent', 'trending', 'popular'],
  bussin: ['great', 'excellent', 'amazing'],
  lowkey: ['somewhat', 'quietly', 'underrated'],
  highkey: ['very', 'clearly', 'obviously'],
  mid: ['mediocre', 'average', 'okay'],
  based: ['good', 'bold', 'correct', 'opinionated'],
  ngl: ['honestly'],
  ml: ['machine learning', 'deep learning', 'ai', 'artificial intelligence'],
  ai: ['artificial intelligence', 'machine learning', 'ml', 'llm', 'neural'],
  llm: ['large language model', 'language model', 'ai'],
  dl: ['deep learning', 'neural network'],
  fe: ['frontend', 'front-end', 'react', 'vue', 'angular'],
  be: ['backend', 'back-end', 'server', 'api'],
  devops: ['deployment', 'ci/cd', 'infrastructure', 'docker', 'kubernetes'],
  ds: ['data science', 'data analysis', 'statistics'],
  ux: ['user experience', 'design', 'usability'],
  ui: ['user interface', 'design', 'interface'],
  js: ['javascript'],
  ts: ['typescript'],
  py: ['python'],
  people: ['person', 'developer', 'engineer', 'researcher', 'author', 'creator', 'founder', 'profile', 'github', 'portfolio'],
  tools: ['tool', 'utility', 'library', 'framework', 'package', 'app', 'software'],
  tutorials: ['tutorial', 'guide', 'course', 'learn', 'walkthrough'],
  articles: ['article', 'blog', 'post', 'essay', 'writing'],
  videos: ['video', 'youtube', 'watch', 'stream'],
  papers: ['paper', 'research', 'arxiv', 'publication', 'study'],
  repos: ['repository', 'github', 'open source', 'code'],
}

function expandTerms(terms: string): string[] {
  const words = terms.toLowerCase().split(/\s+/).filter(Boolean)
  const expanded = new Set<string>(words)

  for (const word of words) {
    const expansions = TERM_EXPANSIONS[word]
    if (!expansions) continue

    for (const expansion of expansions) {
      expanded.add(expansion)
    }
  }

  return [...expanded]
}

function detectIntentHints(query: string): string[] {
  const lower = query.toLowerCase()
  const hints: string[] = []

  if (/\bpeople\b|\bperson\b|\bwho\b|\bdeveloper\b|\bengineer\b|\bresearcher\b|\bauthor\b|\bcreator\b|\bfounder\b/.test(lower)) {
    hints.push('person')
  }
  if (/\btool\b|\blib\b|\blibrary\b|\bframework\b|\bpackage\b|\bapp\b|\bsoftware\b/.test(lower)) {
    hints.push('tool')
  }
  if (/\btutorial\b|\bguide\b|\bcourse\b|\blearn\b|\bhow.?to\b/.test(lower)) {
    hints.push('learning')
  }
  if (/\barticle\b|\bblog\b|\bpost\b|\bwrite\b|\bessay\b|\bread\b/.test(lower)) {
    hints.push('article')
  }
  if (/\bvideo\b|\byoutube\b|\bwatch\b|\bstream\b/.test(lower)) {
    hints.push('video')
  }
  if (/\bpaper\b|\bresearch\b|\bstudy\b|\barxiv\b/.test(lower)) {
    hints.push('research')
  }
  if (/\brepo\b|\bgithub\b|\bcode\b|\bopen.?source\b/.test(lower)) {
    hints.push('code')
  }

  return hints
}

export function parseQuery(query: string): ParsedQuery {
  const { filter: timeFilter, cleaned } = parseTimeFilter(query)
  const intentHints = detectIntentHints(query)
  const fillerWords =
    /\b(the|a|an|of|in|on|at|to|for|with|from|by|about|that|this|my|i|me|some|any|all|those|these)\b/gi

  const searchTerms = cleaned
    .replace(fillerWords, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    searchTerms,
    timeFilter,
    intentHints,
    original: query,
  }
}

export function getExpandedTerms(searchTerms: string): string[] {
  return expandTerms(searchTerms)
}
