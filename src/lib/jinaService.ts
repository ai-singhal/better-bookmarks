// Jina Reader API — free, fast page content extraction
// Returns clean markdown from any URL, handles JS-rendered pages

const JINA_READER_BASE = 'https://r.jina.ai/'
const JINA_TIMEOUT = 10000

export interface JinaPageResult {
  title: string
  description: string
  content: string // clean markdown
  url: string
}

export async function fetchPageWithJina(url: string): Promise<JinaPageResult | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), JINA_TIMEOUT)

    const response = await fetch(`${JINA_READER_BASE}${url}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'X-Return-Format': 'markdown',
      },
    })
    clearTimeout(timeout)

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const json = await response.json()
      return {
        title: json.data?.title || '',
        description: json.data?.description || '',
        content: (json.data?.content || '').slice(0, 8000),
        url: json.data?.url || url,
      }
    }

    // Fallback: plain text/markdown response
    const text = await response.text()
    const titleMatch = text.match(/^#\s+(.+)$/m)
    return {
      title: titleMatch?.[1] || '',
      description: '',
      content: text.slice(0, 8000),
      url,
    }
  } catch {
    return null
  }
}

// Extract a short summary from Jina markdown content
export function extractSummary(content: string, maxLength = 200): string {
  if (!content) return ''

  // Remove markdown headers, links, images
  const cleaned = content
    .replace(/^#+\s+.+$/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()

  // Get first meaningful paragraph
  const lines = cleaned.split('\n').filter((l) => l.trim().length > 20)
  const summary = lines.slice(0, 3).join(' ').trim()

  if (summary.length > maxLength) {
    return summary.slice(0, maxLength - 3) + '...'
  }
  return summary
}

// Batch fetch with concurrency control and progress
export async function batchFetchWithJina(
  urls: string[],
  concurrency = 3,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, JinaPageResult>> {
  const results = new Map<string, JinaPageResult>()
  let done = 0

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const promises = batch.map(async (url) => {
      const result = await fetchPageWithJina(url)
      done++
      onProgress?.(done, urls.length)
      if (result) results.set(url, result)
    })
    await Promise.all(promises)
  }

  return results
}
