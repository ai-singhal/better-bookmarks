import { useState, useEffect, useRef, useCallback } from 'react'
import { getBookmarkTree, flattenBookmarks } from '../../shared/chromeApi'
import { streamAI, executeActions, getOpenAIKey, setOpenAIKey, getOpenAIModel, setOpenAIModel, OPENAI_MODELS, DEFAULT_OPENAI_MODEL, type AIAction, type AIResponse } from '../../lib/openaiService'
import type { BookmarkWithMetadata } from '../../shared/types'
import { cn, getFaviconUrl, truncateUrl, formatRelativeDate } from '../../shared/utils'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  response?: AIResponse
  executionResult?: { success: number; failed: number; errors: string[] }
  executing?: boolean
  streaming?: boolean
  rawContent?: string
}

interface StoredChatSession {
  id: string
  title: string
  updatedAt: number
  model: string
  messages: ChatMessage[]
}

interface StoredChatState {
  activeChatId: string | null
  sessions: StoredChatSession[]
}

const CHAT_STORAGE_KEY = 'ai_chat_sessions_v1'
const MAX_SAVED_CHATS = 15

function sanitizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    streaming: false,
    rawContent: undefined,
  }))
}

function buildChatTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!firstUserMessage) return 'New Chat'

  const title = firstUserMessage.content.trim().replace(/\s+/g, ' ')
  return title.length > 42 ? `${title.slice(0, 42)}…` : title
}

function upsertStoredSession(
  sessions: StoredChatSession[],
  session: StoredChatSession
): StoredChatSession[] {
  return [
    session,
    ...sessions.filter((item) => item.id !== session.id),
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_CHATS)
}

export function Command() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [bookmarkTree, setBookmarkTree] = useState<BookmarkWithMetadata[]>([])
  const [allBookmarks, setAllBookmarks] = useState<Map<string, BookmarkWithMetadata>>(new Map())
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [selectedModel, setSelectedModel] = useState(DEFAULT_OPENAI_MODEL)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [savedChats, setSavedChats] = useState<StoredChatSession[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [chatStateHydrated, setChatStateHydrated] = useState(false)
  const [showChatPicker, setShowChatPicker] = useState(false)
  const [expandedActionMessageIds, setExpandedActionMessageIds] = useState<Set<string>>(new Set())
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load bookmarks and check API key
  useEffect(() => {
    async function init() {
      const tree = await getBookmarkTree()
      setBookmarkTree(tree)
      const flat = flattenBookmarks(tree)
      setAllBookmarks(new Map(flat.map(b => [b.id, b])))

      const key = await getOpenAIKey()
      setHasApiKey(!!key)

      const model = await getOpenAIModel()
      setSelectedModel(model)

      const chatData = await chrome.storage.local.get(CHAT_STORAGE_KEY)
      const stored = chatData[CHAT_STORAGE_KEY] as StoredChatState | undefined

      if (stored?.sessions?.length) {
        const sanitizedSessions = stored.sessions.map((session) => ({
          ...session,
          messages: sanitizeChatMessages(session.messages || []),
        }))
        setSavedChats(sanitizedSessions)

        const activeSession = sanitizedSessions.find((session) => session.id === stored.activeChatId)
        if (activeSession) {
          setActiveChatId(activeSession.id)
          setMessages(activeSession.messages)
        }
      }

      setChatStateHydrated(true)
    }
    init()
  }, [])

  useEffect(() => {
    if (!chatStateHydrated || !activeChatId || messages.length === 0) return

    const session: StoredChatSession = {
      id: activeChatId,
      title: buildChatTitle(messages),
      updatedAt: Date.now(),
      model: selectedModel,
      messages: sanitizeChatMessages(messages),
    }

    setSavedChats((prev) => upsertStoredSession(prev, session))
  }, [activeChatId, chatStateHydrated, messages, selectedModel])

  useEffect(() => {
    if (!chatStateHydrated) return

    const payload: StoredChatState = {
      activeChatId,
      sessions: savedChats,
    }

    chrome.storage.local.set({
      [CHAT_STORAGE_KEY]: payload,
    }).catch((err) => {
      console.error('Failed to persist saved chats:', err)
    })
  }, [activeChatId, chatStateHydrated, savedChats])

  // Reload bookmarks after actions
  const reloadBookmarks = useCallback(async () => {
    const tree = await getBookmarkTree()
    setBookmarkTree(tree)
    const flat = flattenBookmarks(tree)
    setAllBookmarks(new Map(flat.map(b => [b.id, b])))
  }, [])

  // Listen for bookmark changes
  useEffect(() => {
    const listener = (msg: { type: string }) => {
      if (msg.type.startsWith('BOOKMARK_')) void reloadBookmarks()
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [reloadBookmarks])

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return
    setSavingKey(true)
    await setOpenAIKey(apiKeyInput.trim())
    setHasApiKey(true)
    setSavingKey(false)
    setApiKeyInput('')
  }

  const handleSend = async () => {
    const query = input.trim()
    if (!query || loading) return

    setInput('')
    const currentChatId = activeChatId || `chat-${Date.now()}`
    if (!activeChatId) {
      setActiveChatId(currentChatId)
    }

    const userMessageId = `user-${Date.now()}`
    const assistantMessageId = `assistant-${Date.now()}`
    const userMsg: ChatMessage = { id: userMessageId, role: 'user', content: query }
    const assistantMsg: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: 'Thinking…',
      streaming: true,
      rawContent: '',
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setLoading(true)

    try {
      // Build conversation history (last 6 messages for context)
      const history = messages.slice(-6).map(m => ({
        role: m.role,
        content: m.role === 'assistant' && m.response
          ? m.response.message
          : m.content,
      }))

      const response = await streamAI(query, bookmarkTree, history, {
        onMessage: (content, rawContent) => {
          setMessages(prev => prev.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: content || 'Thinking…',
                  rawContent,
                  streaming: true,
                }
              : message
          ))
        },
      })

      setMessages(prev => prev.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: response.message || message.content,
              response,
              streaming: false,
              rawContent: undefined,
            }
          : message
      ))
    } catch (err) {
      setMessages(prev => prev.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: err instanceof Error ? err.message : 'Something went wrong.',
              streaming: false,
              rawContent: undefined,
            }
          : message
      ))
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleStartNewChat = () => {
    setMessages([])
    setActiveChatId(null)
    setInput('')
    setShowChatPicker(false)
    inputRef.current?.focus()
  }

  const handleSelectChat = (chatId: string) => {
    const selectedChat = savedChats.find((chat) => chat.id === chatId)
    if (!selectedChat) return

    setActiveChatId(selectedChat.id)
    setMessages(sanitizeChatMessages(selectedChat.messages))
    setShowChatPicker(false)
    setInput('')
    inputRef.current?.focus()
  }

  const handleDeleteChat = (chatId: string) => {
    setSavedChats((prev) => prev.filter((chat) => chat.id !== chatId))

    if (activeChatId === chatId) {
      setActiveChatId(null)
      setMessages([])
      setInput('')
    }
  }

  const handleExecuteActions = async (msgIndex: number) => {
    const msg = messages[msgIndex]
    if (!msg.response?.actions?.length) return

    // Filter out search_results — those don't need execution
    const executableActions = msg.response.actions.filter(a => a.type !== 'search_results')
    if (executableActions.length === 0) return

    setMessages(prev => prev.map((m, i) =>
      i === msgIndex ? { ...m, executing: true } : m
    ))

    const result = await executeActions(executableActions)
    await reloadBookmarks()

    setMessages(prev => prev.map((m, i) =>
      i === msgIndex ? { ...m, executing: false, executionResult: result } : m
    ))
  }

  const getActionSummary = (actions: AIAction[]): string => {
    const counts: Record<string, number> = {}
    for (const a of actions) {
      if (a.type === 'search_results') continue
      counts[a.type] = (counts[a.type] || 0) + 1
    }
    return Object.entries(counts)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ')
  }

  const hasExecutableActions = (actions: AIAction[]) =>
    actions.some(a => a.type !== 'search_results')

  const toggleExpandedActions = (messageId: string) => {
    setExpandedActionMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  // API key setup screen
  if (hasApiKey === false) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.5 4.5a3.5 3.5 0 00-3.5 3.5v.5a3 3 0 00-2 2.828V13a3 3 0 003 3h.25a2.75 2.75 0 002.5 2h.5A2.75 2.75 0 0013 16h.5a2.5 2.5 0 002.5-2.5V13h.25a3 3 0 003-3v-1.672A3 3 0 0017 5.5V5a3.5 3.5 0 00-6.362-2.044A3.48 3.48 0 009.5 4.5zm-1 4.25h.5m6.5 0h.5M9 12.5h1m4 0h1M12 4v10" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-100">Set up AI</h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              Enter your OpenAI API key to enable natural language search, bulk organization,
              and intelligent bookmark management. Your key is stored locally.
            </p>
          </div>

          <div className="space-y-3">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              placeholder="sk-..."
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
            <button
              onClick={handleSaveKey}
              disabled={!apiKeyInput.trim() || savingKey}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {savingKey ? 'Saving...' : 'Save & Continue'}
            </button>
            <p className="text-[11px] text-gray-600 text-center">
              Defaults to GPT-5.4 mini. You can switch models later from Settings or the AI Chat header.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (hasApiKey === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">AI Chat</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Search, organize, and manage your bookmarks with natural language.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowChatPicker(!showChatPicker)}
                className="text-xs text-gray-400 hover:text-gray-200 px-2.5 py-1 rounded border border-gray-800 hover:border-gray-700 hover:bg-gray-800 transition-colors"
              >
                Chats
              </button>
              {showChatPicker && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-200">Saved Chats</p>
                    <span className="text-[10px] text-gray-500">{savedChats.length}</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {savedChats.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-500">
                        No saved chats yet. Start a conversation and it will show up here.
                      </p>
                    ) : (
                      savedChats.map((chat) => (
                        <div key={chat.id} className="flex items-center gap-2 px-2 py-1">
                          <button
                            onClick={() => handleSelectChat(chat.id)}
                            className={cn(
                              'flex-1 text-left px-2.5 py-2 rounded-lg hover:bg-gray-800 transition-colors',
                              activeChatId === chat.id && 'bg-gray-800'
                            )}
                          >
                            <p className="text-xs font-medium text-gray-200 truncate">{chat.title}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {formatRelativeDate(chat.updatedAt)} • {chat.messages.length} messages
                            </p>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteChat(chat.id)
                            }}
                            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                            title="Delete chat"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-900/30 hover:bg-emerald-900/50 transition-colors flex items-center gap-1"
              >
                {OPENAI_MODELS.find(m => m.id === selectedModel)?.label || selectedModel}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showModelPicker && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                  {OPENAI_MODELS.map((model) => (
                    <button
                      key={model.id}
                      onClick={async () => {
                        setSelectedModel(model.id)
                        await setOpenAIModel(model.id)
                        setShowModelPicker(false)
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors',
                        selectedModel === model.id && 'bg-gray-800'
                      )}
                    >
                      <div>
                        <p className="text-xs font-medium text-gray-200">{model.label}</p>
                        <p className="text-[10px] text-gray-500">{model.description}</p>
                      </div>
                      {selectedModel === model.id && (
                        <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setHasApiKey(false)}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
              title="Change API key"
            >
              Key
            </button>
            <button
              onClick={handleStartNewChat}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
            >
              New Chat
            </button>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400 mb-6">Ask me anything about your bookmarks</p>
            <div className="grid gap-2 w-full max-w-lg">
              {[
                'Move all GitHub bookmarks to a "Dev" folder',
                'Find my bookmarks about machine learning',
                'Sort my bookmarks bar alphabetically',
                'Delete all duplicate bookmarks',
                'Create folders and organize my bookmarks by topic',
                'Find bookmarks I haven\'t categorized well',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus() }}
                  className="px-4 py-2.5 text-left text-sm text-gray-400 bg-gray-900/50 border border-gray-800 rounded-xl hover:bg-gray-800 hover:text-gray-200 hover:border-gray-700 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] rounded-2xl px-4 py-3',
              msg.role === 'user'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-900 border border-gray-800 text-gray-200'
            )}>
              {/* Message text */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content}
                {msg.streaming && (
                  <span className="inline-block w-2 h-4 ml-1 align-[-2px] bg-indigo-400/70 animate-pulse rounded-sm" />
                )}
              </p>

              {/* Search results */}
              {msg.response?.searchResults && msg.response.searchResults.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                    {msg.response.searchResults.length} results
                  </p>
                  {msg.response.searchResults.map((sr) => {
                    const bookmark = allBookmarks.get(sr.bookmarkId)
                    if (!bookmark) return null
                    return (
                      <button
                        key={sr.bookmarkId}
                        onClick={() => bookmark.url && chrome.tabs.create({ url: bookmark.url })}
                        className="w-full flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-800/50 hover:bg-gray-800 transition-colors text-left"
                      >
                        <img
                          src={bookmark.url ? getFaviconUrl(bookmark.url) : ''}
                          alt=""
                          className="w-4 h-4 rounded flex-shrink-0 mt-0.5"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-200 truncate">
                            {bookmark.title || 'Untitled'}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate mt-0.5">
                            {bookmark.url ? truncateUrl(bookmark.url, 50) : ''}
                          </p>
                          {sr.reason && (
                            <p className="text-[10px] text-gray-500 mt-0.5 italic">{sr.reason}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-600 flex-shrink-0">
                          {formatRelativeDate(bookmark.dateAdded)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Pending actions */}
              {msg.response && hasExecutableActions(msg.response.actions) && !msg.executionResult && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  {(() => {
                    const executableActions = msg.response.actions.filter(a => a.type !== 'search_results')
                    const isExpanded = expandedActionMessageIds.has(msg.id)
                    const visibleActions = isExpanded ? executableActions : executableActions.slice(0, 8)

                    return (
                      <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      Pending: {getActionSummary(msg.response.actions)}
                    </p>
                    <button
                      onClick={() => handleExecuteActions(i)}
                      disabled={msg.executing}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                        msg.executing
                          ? 'bg-gray-700 text-gray-400'
                          : 'bg-indigo-600 text-white hover:bg-indigo-500'
                      )}
                    >
                      {msg.executing ? (
                        <span className="flex items-center gap-1.5">
                          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Running...
                        </span>
                      ) : (
                        'Run'
                      )}
                    </button>
                  </div>

                  {/* Action preview */}
                  <div className="mt-2 space-y-1">
                    {visibleActions.map((action, j) => (
                      <div key={j} className="flex items-center gap-2 text-[11px] text-gray-500">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded font-mono',
                          action.type === 'move' ? 'bg-blue-900/30 text-blue-400' :
                          action.type === 'create_folder' ? 'bg-emerald-900/30 text-emerald-400' :
                          action.type === 'delete' ? 'bg-red-900/30 text-red-400' :
                          action.type === 'rename' ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-gray-800 text-gray-400'
                        )}>
                          {action.type}
                        </span>
                        <span className="truncate">
                          {action.type === 'create_folder' && `"${action.title}"`}
                          {action.type === 'move' && (() => {
                            const bk = allBookmarks.get(action.bookmarkId || '')
                            return bk ? `"${bk.title}"` : action.bookmarkId
                          })()}
                          {action.type === 'delete' && (() => {
                            const bk = allBookmarks.get(action.bookmarkId || '')
                            return bk ? `"${bk.title}"` : action.bookmarkId
                          })()}
                          {action.type === 'rename' && `→ "${action.title}"`}
                          {action.type === 'reorder' && (() => {
                            const bk = allBookmarks.get(action.bookmarkId || '')
                            return bk ? `"${bk.title}" → position ${action.index}` : ''
                          })()}
                        </span>
                      </div>
                    ))}
                    {executableActions.length > 8 && (
                      <button
                        onClick={() => toggleExpandedActions(msg.id)}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        {isExpanded
                          ? 'Show fewer actions'
                          : `Show all ${executableActions.length} actions`}
                      </button>
                    )}
                  </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Execution result */}
              {msg.executionResult && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <div className="flex items-center gap-2 text-xs">
                    {msg.executionResult.failed === 0 ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Done — {msg.executionResult.success} action{msg.executionResult.success !== 1 && 's'} completed
                      </span>
                    ) : (
                      <span className="text-amber-400">
                        {msg.executionResult.success} succeeded, {msg.executionResult.failed} failed
                      </span>
                    )}
                  </div>
                  {msg.executionResult.errors.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {msg.executionResult.errors.map((err, j) => (
                        <p key={j} className="text-[10px] text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && !messages.some((message) => message.streaming) && (
          <div className="flex justify-start">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="px-6 py-4 border-t border-gray-800 flex-shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Search, organize, or ask anything about your bookmarks..."
            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
            rows={1}
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-2 text-center">
          Press Enter to send. The AI sees your full bookmark tree and can execute actions.
        </p>
      </div>
    </div>
  )
}
