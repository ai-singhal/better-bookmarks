import { useState, useEffect, useRef, useCallback } from 'react'
import { getBookmarkTree } from '../../shared/chromeApi'
import {
  streamAI,
  executeActions,
  getOpenAIKey,
  type AIResponse,
} from '../../lib/openaiService'
import { fetchPageWithJina, extractSummary } from '../../lib/jinaService'
import { confirmSnapshotProtection } from '../../lib/aiActionSafety'
import { getFaviconUrl } from '../../shared/utils'

interface PageInfo {
  url: string
  title: string
  favIconUrl?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  response?: AIResponse
  executionResult?: { success: number; failed: number; errors: string[] }
  executing?: boolean
  streaming?: boolean
}

const SUGGESTIONS_BOOKMARKED = [
  'Move to a better folder',
  'Find similar bookmarks',
  'Add tags for this page',
]

const SUGGESTIONS_NOT_BOOKMARKED = [
  'Bookmark this page',
  'Bookmark in best folder',
  'Summarize this page',
]

export function AIPanel() {
  const [page, setPage] = useState<PageInfo | null>(null)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [existingBookmark, setExistingBookmark] = useState<{ id: string; parentId?: string; folderName?: string } | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(true)
  const [pageSummary, setPageSummary] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Get current tab info and check if bookmarked
  useEffect(() => {
    getOpenAIKey().then((key) => setHasApiKey(!!key))

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.url || tab.url.startsWith('chrome://')) {
        setPage(null)
        return
      }
      setPage({
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl,
      })

      // Check if this URL is already bookmarked
      chrome.bookmarks.search({ url: tab.url }, async (results) => {
        if (results.length > 0) {
          setIsBookmarked(true)
          const bm = results[0]
          let folderName = ''
          if (bm.parentId) {
            try {
              const [parent] = await chrome.bookmarks.get(bm.parentId)
              folderName = parent.title || ''
            } catch { /* ignore */ }
          }
          setExistingBookmark({ id: bm.id, parentId: bm.parentId, folderName })
        }
      })
    })
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const buildPageContext = useCallback(async (): Promise<string> => {
    if (!page) return ''
    let context = `\n## Current Page\nThe user is currently viewing:\n- Title: ${page.title}\n- URL: ${page.url}`
    if (isBookmarked && existingBookmark) {
      context += `\n- Status: Already bookmarked (ID: ${existingBookmark.id}, folder: "${existingBookmark.folderName || 'Unknown'}")`
    } else {
      context += `\n- Status: NOT bookmarked yet`
    }
    if (pageSummary) {
      context += `\n- Page summary: ${pageSummary}`
    }
    context += `\n\nWhen the user says "this page" or "this", they mean the page above. If they want to bookmark it, use the create_bookmark action with the URL and title above. If they want to move it, use the existing bookmark ID.`
    return context
  }, [page, isBookmarked, existingBookmark, pageSummary])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return
    setInput('')

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
    }

    const assistantMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      streaming: true,
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    try {
      const tree = await getBookmarkTree()
      const pageContext = await buildPageContext()

      const history = messages
        .filter((m) => !m.streaming)
        .map((m) => ({
          role: m.role,
          content: m.role === 'assistant' ? (m.response ? JSON.stringify(m.response) : m.content) : m.content,
        }))

      const response = await streamAI(
        text.trim(),
        tree,
        history,
        {
          onMessage: (display) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: display } : m
              )
            )
          },
        },
        { additionalContext: pageContext }
      )

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: response.message, response, streaming: false }
            : m
        )
      )

      // Auto-execute non-major actions
      const executableActions = response.actions.filter((a) => a.type !== 'search_results')
      if (executableActions.length > 0) {
        const safe = await confirmSnapshotProtection(response.actions)
        if (safe) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, executing: true } : m
            )
          )

          const result = await executeActions(executableActions)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, executing: false, executionResult: result }
                : m
            )
          )

          // Refresh bookmark status after actions
          if (page?.url) {
            chrome.bookmarks.search({ url: page.url }, async (results) => {
              if (results.length > 0) {
                setIsBookmarked(true)
                const bm = results[0]
                let folderName = ''
                if (bm.parentId) {
                  try {
                    const [parent] = await chrome.bookmarks.get(bm.parentId)
                    folderName = parent.title || ''
                  } catch { /* ignore */ }
                }
                setExistingBookmark({ id: bm.id, parentId: bm.parentId, folderName })
              }
            })
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`, streaming: false }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
    }
  }, [isStreaming, messages, buildPageContext, page])

  const handleSummarize = async () => {
    if (!page || loadingSummary) return
    setLoadingSummary(true)
    try {
      const result = await fetchPageWithJina(page.url)
      if (result) {
        const summary = extractSummary(result.content, 300)
        setPageSummary(summary)
        // Also send as a message for the user to see
        sendMessage('Summarize this page for me')
      }
    } catch {
      setPageSummary(null)
    } finally {
      setLoadingSummary(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const suggestions = isBookmarked ? SUGGESTIONS_BOOKMARKED : SUGGESTIONS_NOT_BOOKMARKED

  if (!hasApiKey) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
        <p className="text-sm text-gray-400">OpenAI API key required</p>
        <button
          onClick={() => {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html#settings') })
            window.close()
          }}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          Configure in Settings
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Page context banner */}
      {page && (
        <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            {page.favIconUrl ? (
              <img src={page.favIconUrl} alt="" className="w-4 h-4 rounded flex-shrink-0" />
            ) : page.url ? (
              <img src={getFaviconUrl(page.url)} alt="" className="w-4 h-4 rounded flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : null}
            <span className="text-xs text-gray-300 truncate flex-1">{page.title}</span>
            {isBookmarked ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 flex-shrink-0">
                Bookmarked{existingBookmark?.folderName ? ` · ${existingBookmark.folderName}` : ''}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 flex-shrink-0">
                Not saved
              </span>
            )}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-4">
            <div className="text-center">
              <p className="text-sm text-gray-400 mb-1">Ask me anything about this page</p>
              <p className="text-xs text-gray-600">I can bookmark, organize, search, and more</p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-1.5 justify-center max-w-[300px]">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                >
                  {s}
                </button>
              ))}
              {!isBookmarked && (
                <button
                  onClick={handleSummarize}
                  disabled={loadingSummary}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                >
                  {loadingSummary ? 'Loading...' : 'Summarize this page'}
                </button>
              )}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-200'
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{msg.content || (msg.streaming ? '...' : '')}</p>
                {msg.executing && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-indigo-400">
                    <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    Executing...
                  </div>
                )}
                {msg.executionResult && (
                  <div className={`mt-1.5 text-xs ${msg.executionResult.failed > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {msg.executionResult.success > 0 && `${msg.executionResult.success} action${msg.executionResult.success === 1 ? '' : 's'} completed`}
                    {msg.executionResult.failed > 0 && ` · ${msg.executionResult.failed} failed`}
                  </div>
                )}
                {msg.response?.searchResults && msg.response.searchResults.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.response.searchResults.slice(0, 5).map((r) => (
                      <button
                        key={r.bookmarkId}
                        onClick={async () => {
                          try {
                            const [bm] = await chrome.bookmarks.get(r.bookmarkId)
                            if (bm.url) {
                              chrome.tabs.create({ url: bm.url })
                              window.close()
                            }
                          } catch { /* ignore */ }
                        }}
                        className="block w-full text-left text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 truncate"
                        title={r.reason}
                      >
                        {r.reason}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-800 flex-shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={page ? `Ask about "${page.title.slice(0, 30)}..."` : 'Ask anything...'}
            rows={1}
            disabled={isStreaming}
            className="w-full pl-3 pr-9 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-indigo-400 disabled:opacity-30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
