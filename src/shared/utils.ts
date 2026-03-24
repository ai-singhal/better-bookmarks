import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

const unavailableFaviconHosts = new Set<string>()

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown'
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatRelativeDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown'
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 30) return formatDate(timestamp)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'Just now'
}

export function truncateUrl(url: string, maxLength = 50): string {
  try {
    const parsed = new URL(url)
    const display = parsed.hostname + parsed.pathname
    return display.length > maxLength
      ? display.slice(0, maxLength) + '...'
      : display
  } catch {
    return url.length > maxLength ? url.slice(0, maxLength) + '...' : url
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function getFaviconUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (unavailableFaviconHosts.has(parsed.hostname)) return ''
    const domain = parsed.origin
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  } catch {
    return ''
  }
}

export function markFaviconUnavailable(url: string): void {
  try {
    unavailableFaviconHosts.add(new URL(url).hostname)
  } catch {
    // Ignore bad URLs.
  }
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
