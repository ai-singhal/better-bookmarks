// Fast page content extraction for bookmark indexing
// Fetches pages and extracts meaningful text for vectorization

export interface ParsedPage {
  title: string
  description: string
  headings: string[]
  mainText: string
  keywords: string[]
  author: string
  publishDate: string
  domain: string
  fullText: string // Combined text for indexing
}

const FETCH_TIMEOUT = 8000
const MAX_TEXT_LENGTH = 5000

export async function parsePage(url: string): Promise<ParsedPage | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html',
      },
    })
    clearTimeout(timeout)

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return null

    const html = await response.text()
    return parseHTML(html, url)
  } catch {
    return null
  }
}

function parseHTML(html: string, url: string): ParsedPage {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Remove noise elements
  const noiseSelectors = 'script, style, nav, footer, header, aside, [role="banner"], [role="navigation"], .ad, .ads, .advertisement, .sidebar, .comments, .cookie-banner, noscript, iframe'
  doc.querySelectorAll(noiseSelectors).forEach((el) => el.remove())

  const title = extractTitle(doc)
  const description = extractMeta(doc, 'description') || extractMeta(doc, 'og:description') || ''
  const headings = extractHeadings(doc)
  const mainText = extractMainText(doc)
  const keywords = extractKeywords(doc)
  const author = extractMeta(doc, 'author') || extractMeta(doc, 'og:article:author') || ''
  const publishDate = extractMeta(doc, 'article:published_time') || extractMeta(doc, 'date') || ''
  const domain = getDomain(url)

  const fullText = buildFullText({ title, description, headings, mainText, keywords, author, domain })

  return { title, description, headings, mainText, keywords, author, publishDate, domain, fullText }
}

function extractTitle(doc: Document): string {
  const ogTitle = extractMeta(doc, 'og:title')
  if (ogTitle) return ogTitle
  const titleEl = doc.querySelector('title')
  if (titleEl) return titleEl.textContent?.trim() || ''
  const h1 = doc.querySelector('h1')
  return h1?.textContent?.trim() || ''
}

function extractMeta(doc: Document, name: string): string {
  const el =
    doc.querySelector(`meta[name="${name}"]`) ||
    doc.querySelector(`meta[property="${name}"]`) ||
    doc.querySelector(`meta[property="og:${name}"]`)
  return el?.getAttribute('content')?.trim() || ''
}

function extractHeadings(doc: Document): string[] {
  const headings: string[] = []
  doc.querySelectorAll('h1, h2, h3').forEach((el) => {
    const text = el.textContent?.trim()
    if (text && text.length > 2 && text.length < 200) {
      headings.push(text)
    }
  })
  return headings.slice(0, 15)
}

function extractMainText(doc: Document): string {
  // Try article or main content first
  const contentSelectors = ['article', 'main', '[role="main"]', '.post-content', '.article-body', '.entry-content', '.content']
  for (const selector of contentSelectors) {
    const el = doc.querySelector(selector)
    if (el) {
      const text = cleanText(el.textContent || '')
      if (text.length > 100) {
        return text.slice(0, MAX_TEXT_LENGTH)
      }
    }
  }

  // Fallback: extract from body paragraphs
  const paragraphs: string[] = []
  doc.querySelectorAll('p').forEach((p) => {
    const text = p.textContent?.trim()
    if (text && text.length > 30) {
      paragraphs.push(text)
    }
  })

  if (paragraphs.length > 0) {
    return paragraphs.join(' ').slice(0, MAX_TEXT_LENGTH)
  }

  return cleanText(doc.body?.textContent || '').slice(0, MAX_TEXT_LENGTH)
}

function extractKeywords(doc: Document): string[] {
  const meta = extractMeta(doc, 'keywords')
  if (meta) {
    return meta.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 20)
  }
  return []
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return ''
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()
}

function buildFullText(parts: {
  title: string
  description: string
  headings: string[]
  mainText: string
  keywords: string[]
  author: string
  domain: string
}): string {
  const sections = [
    parts.title,
    parts.description,
    parts.headings.join(' '),
    parts.mainText,
    parts.keywords.join(' '),
    parts.author,
    parts.domain,
  ].filter(Boolean)
  return sections.join(' ').slice(0, MAX_TEXT_LENGTH * 2)
}

// Batch parse multiple pages with concurrency control
export async function batchParsePagesWithProgress(
  urls: string[],
  concurrency = 3,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, ParsedPage>> {
  const results = new Map<string, ParsedPage>()
  let done = 0

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const promises = batch.map(async (url) => {
      const parsed = await parsePage(url)
      done++
      onProgress?.(done, urls.length)
      if (parsed) results.set(url, parsed)
    })
    await Promise.all(promises)
  }

  return results
}
