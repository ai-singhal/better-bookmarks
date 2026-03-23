// Content script for extracting page metadata
// Used when a new bookmark is created to get page content for AI processing

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE_METADATA') {
    const metadata = extractMetadata()
    sendResponse(metadata)
  }
  return true
})

function extractMetadata() {
  const title = document.title
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    ''

  const ogTitle =
    document.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''

  const ogImage =
    document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''

  // Get first 500 chars of visible text
  const bodyText = document.body?.innerText?.slice(0, 500) || ''

  // Get keywords
  const keywords =
    document.querySelector('meta[name="keywords"]')?.getAttribute('content') || ''

  return {
    title,
    description,
    ogTitle,
    ogImage,
    bodyText,
    keywords,
    url: window.location.href,
  }
}
