// OpenAI-powered bookmark AI — search, organize, mass operations
// Calls OpenAI API directly from extension, key stored in chrome.storage.sync

import type { BookmarkWithMetadata } from '../shared/types'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

export interface OpenAIModelOption {
  id: string
  label: string
  description: string
}

// Curated from the current OpenAI API model docs.
// Keep this list focused on relevant text models for the bookmark Command workflow:
// https://platform.openai.com/docs/models/model-endpoint-compatibility
// https://developers.openai.com/api/docs/models/gpt-5.4
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
// https://developers.openai.com/api/docs/models/gpt-5.4-nano
// https://developers.openai.com/api/docs/models/gpt-4.1
export const OPENAI_MODELS = [
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    description: 'Best default for this app: fast, lower-cost, and strong for everyday bookmark commands',
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Best quality for complex organization, planning, and multi-step reasoning',
  },
  {
    id: 'gpt-5.4-nano',
    label: 'GPT-5.4 nano',
    description: 'Cheapest option for simple, high-volume tasks like light classification and cleanup',
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    description: 'Strong non-reasoning fallback with solid instruction following and tool calling',
  },
] satisfies readonly OpenAIModelOption[]

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'

function isSupportedOpenAIModel(model: string): boolean {
  return OPENAI_MODELS.some((option) => option.id === model)
}

// ─── Types ───

export interface AIAction {
  type: 'move' | 'create_folder' | 'reorder' | 'delete' | 'rename' | 'search_results'
  bookmarkId?: string
  bookmarkIds?: string[]
  destinationFolderId?: string
  parentId?: string
  index?: number
  title?: string
}

export interface AIResponse {
  message: string
  actions: AIAction[]
  // For search results, includes matched bookmark IDs with reasons
  searchResults?: Array<{ bookmarkId: string; reason: string }>
}

interface AIStreamCallbacks {
  onMessage?: (displayContent: string, rawContent: string) => void
}

// ─── API Key Management ───

export async function getOpenAIKey(): Promise<string> {
  const data = await chrome.storage.sync.get('settings')
  const settings = data.settings as Record<string, string> | undefined
  return settings?.openaiApiKey || ''
}

export async function setOpenAIKey(key: string): Promise<void> {
  const data = await chrome.storage.sync.get('settings')
  const settings = (data.settings as Record<string, unknown>) || {}
  settings.openaiApiKey = key
  await chrome.storage.sync.set({ settings })
}

export async function getOpenAIModel(): Promise<string> {
  const data = await chrome.storage.sync.get('settings')
  const settings = data.settings as Record<string, string> | undefined
  const model = settings?.openaiModel
  return model && isSupportedOpenAIModel(model) ? model : DEFAULT_OPENAI_MODEL
}

export async function setOpenAIModel(model: string): Promise<void> {
  const data = await chrome.storage.sync.get('settings')
  const settings = (data.settings as Record<string, unknown>) || {}
  settings.openaiModel = model
  await chrome.storage.sync.set({ settings })
}

// ─── Bookmark Tree Serialization ───

function serializeBookmarkTree(nodes: BookmarkWithMetadata[], depth = 0): string {
  const lines: string[] = []
  const indent = '  '.repeat(depth)

  for (const node of nodes) {
    if (!node.url && node.children !== undefined) {
      // Folder
      const childCount = node.children.filter(c => c.url).length
      lines.push(`${indent}[F:${node.id}] ${node.title} (${childCount} bookmarks)`)
      if (node.children.length > 0) {
        lines.push(serializeBookmarkTree(node.children, depth + 1))
      }
    } else if (node.url) {
      // Bookmark
      lines.push(`${indent}[B:${node.id}] ${node.title} | ${node.url}`)
    }
  }

  return lines.filter(Boolean).join('\n')
}

// ─── System Prompt ───

function buildSystemPrompt(bookmarkTree: string): string {
  return `You are an AI assistant that manages Chrome bookmarks. You have access to the user's full bookmark tree and can execute actions on it.

## Bookmark Tree
The tree uses this format:
- [F:id] Folder Name (N bookmarks) = folder with ID
- [B:id] Title | URL = bookmark with ID
Indentation shows nesting.

${bookmarkTree}

## Your Capabilities
You can:
1. **Search** — Find bookmarks matching a description, topic, or URL pattern. Return them as search_results.
2. **Move** — Move bookmarks between folders. Use "move" actions.
3. **Reorder** — Change the order of bookmarks within a folder. Use "reorder" actions with the target index (0-based).
4. **Create Folders** — Create new folders. Use "create_folder" with parentId and title.
5. **Delete** — Remove bookmarks or empty folders. Use "delete" actions.
6. **Rename** — Rename bookmarks or folders. Use "rename" actions with new title.
7. **Bulk operations** — You can return multiple actions at once.

## Response Format
You MUST respond with valid JSON only (no markdown, no code fences). The schema:
{
  "message": "A brief, friendly explanation of what you're doing/found",
  "actions": [
    { "type": "move", "bookmarkId": "id", "destinationFolderId": "folderId" },
    { "type": "create_folder", "parentId": "parentFolderId", "title": "New Folder Name" },
    { "type": "reorder", "bookmarkId": "id", "parentId": "folderId", "index": 0 },
    { "type": "delete", "bookmarkId": "id" },
    { "type": "rename", "bookmarkId": "id", "title": "New Title" },
    { "type": "search_results", "bookmarkIds": ["id1", "id2"] }
  ],
  "searchResults": [
    { "bookmarkId": "id", "reason": "Why this matched" }
  ]
}

Rules:
- actions array can be empty if user is just asking a question
- For search queries, use "search_results" action type with matching bookmark IDs AND populate "searchResults" with reasons
- For move/organize requests, generate the actual move actions with real IDs from the tree
- If a folder doesn't exist yet and is needed, create it first (create_folder action) then reference it. Use a placeholder ID like "new_1", "new_2" for new folders and reference them in subsequent move actions.
- Be smart about organization — group by topic, domain, or purpose as appropriate
- When reordering, specify the new index positions carefully
- Always explain what you're doing in the message field
- Only use IDs that exist in the bookmark tree above, or placeholder IDs for new folders
- Be concise but helpful in your message`
}

function parseAIResponseContent(content: string): AIResponse {
  try {
    const cleaned = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
    const parsed = JSON.parse(cleaned) as AIResponse
    return {
      message: parsed.message || '',
      actions: parsed.actions || [],
      searchResults: parsed.searchResults,
    }
  } catch {
    return {
      message: content,
      actions: [],
    }
  }
}

function extractMessagePreview(content: string): string {
  const messageKeyMatch = /"message"\s*:\s*"/.exec(content)
  if (!messageKeyMatch) {
    return content.trim()
  }

  let value = ''
  let escaped = false

  for (let i = messageKeyMatch.index + messageKeyMatch[0].length; i < content.length; i++) {
    const char = content[i]

    if (escaped) {
      switch (char) {
        case 'n':
          value += '\n'
          break
        case 'r':
          break
        case 't':
          value += '\t'
          break
        case '"':
        case '\\':
        case '/':
          value += char
          break
        default:
          value += char
          break
      }
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"') {
      break
    }

    value += char
  }

  return value.trim()
}

function readDeltaText(delta: unknown): string {
  if (typeof delta === 'string') return delta

  if (Array.isArray(delta)) {
    return delta.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String(part.text || '')
      }
      return ''
    }).join('')
  }

  return ''
}

// ─── API Call ───

export async function queryAI(
  prompt: string,
  bookmarkTree: BookmarkWithMetadata[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<AIResponse> {
  const apiKey = await getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add it in the settings below.')
  }

  const rootChildren = bookmarkTree[0]?.children || bookmarkTree
  const serialized = serializeBookmarkTree(rootChildren)
  const systemPrompt = buildSystemPrompt(serialized)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: prompt },
  ]

  const selectedModel = await getOpenAIModel()

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature: 0.1,
      max_completion_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    if (response.status === 401) {
      throw new Error('Invalid OpenAI API key. Check your key in settings.')
    }
    throw new Error(`OpenAI API error (${response.status}): ${err}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''

  return parseAIResponseContent(content)
}

export async function streamAI(
  prompt: string,
  bookmarkTree: BookmarkWithMetadata[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  callbacks: AIStreamCallbacks = {}
): Promise<AIResponse> {
  const apiKey = await getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add it in the settings below.')
  }

  const rootChildren = bookmarkTree[0]?.children || bookmarkTree
  const serialized = serializeBookmarkTree(rootChildren)
  const systemPrompt = buildSystemPrompt(serialized)
  const selectedModel = await getOpenAIModel()

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    })),
    { role: 'user', content: prompt },
  ]

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature: 0.1,
      max_completion_tokens: 4096,
      stream: true,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    if (response.status === 401) {
      throw new Error('Invalid OpenAI API key. Check your key in settings.')
    }
    throw new Error(`OpenAI API error (${response.status}): ${err}`)
  }

  if (!response.body) {
    return queryAI(prompt, bookmarkTree, conversationHistory)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let sseBuffer = ''
  let rawContent = ''

  while (true) {
    const { done, value } = await reader.read()
    sseBuffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    let eventBoundary = sseBuffer.indexOf('\n\n')
    while (eventBoundary !== -1) {
      const rawEvent = sseBuffer.slice(0, eventBoundary)
      sseBuffer = sseBuffer.slice(eventBoundary + 2)

      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') continue

        try {
          const chunk = JSON.parse(data)
          const deltaText = readDeltaText(chunk.choices?.[0]?.delta?.content)
          if (!deltaText) continue

          rawContent += deltaText
          const preview = extractMessagePreview(rawContent)
          callbacks.onMessage?.(preview || rawContent, rawContent)
        } catch (err) {
          console.warn('Failed to parse streaming OpenAI chunk:', err)
        }
      }

      eventBoundary = sseBuffer.indexOf('\n\n')
    }

    if (done) break
  }

  const parsed = parseAIResponseContent(rawContent)
  callbacks.onMessage?.(parsed.message || extractMessagePreview(rawContent) || rawContent, rawContent)
  return parsed
}

// ─── Action Execution ───

export async function executeActions(
  actions: AIAction[],
  onProgress?: (completed: number, total: number, description: string) => void
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0
  let failed = 0
  const errors: string[] = []

  // Track placeholder folder IDs → real IDs
  const folderIdMap = new Map<string, string>()

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    try {
      // Resolve placeholder IDs
      const resolveId = (id?: string) => {
        if (!id) return id
        return folderIdMap.get(id) || id
      }

      switch (action.type) {
        case 'create_folder': {
          const parentId = resolveId(action.parentId) || '1'
          const result = await chrome.bookmarks.create({
            parentId,
            title: action.title || 'New Folder',
          })
          // Map placeholder to real ID if present
          if (action.bookmarkId) {
            folderIdMap.set(action.bookmarkId, result.id)
          }
          // Also map common placeholder patterns
          const placeholderKey = `new_${folderIdMap.size}`
          folderIdMap.set(placeholderKey, result.id)
          onProgress?.(i + 1, actions.length, `Created folder "${action.title}"`)
          success++
          break
        }
        case 'move': {
          const destId = resolveId(action.destinationFolderId)
          if (action.bookmarkId && destId) {
            await chrome.bookmarks.move(action.bookmarkId, { parentId: destId })
            onProgress?.(i + 1, actions.length, `Moved bookmark`)
            success++
          }
          break
        }
        case 'reorder': {
          const parentId = resolveId(action.parentId)
          if (action.bookmarkId && parentId && action.index !== undefined) {
            await chrome.bookmarks.move(action.bookmarkId, {
              parentId,
              index: action.index,
            })
            onProgress?.(i + 1, actions.length, `Reordered bookmark`)
            success++
          }
          break
        }
        case 'delete': {
          if (action.bookmarkId) {
            try {
              await chrome.bookmarks.remove(action.bookmarkId)
            } catch {
              // Try removeTree for folders
              await chrome.bookmarks.removeTree(action.bookmarkId)
            }
            onProgress?.(i + 1, actions.length, `Deleted bookmark`)
            success++
          }
          break
        }
        case 'rename': {
          if (action.bookmarkId && action.title) {
            await chrome.bookmarks.update(action.bookmarkId, { title: action.title })
            onProgress?.(i + 1, actions.length, `Renamed to "${action.title}"`)
            success++
          }
          break
        }
        case 'search_results': {
          // No action needed, results are displayed in UI
          success++
          break
        }
      }
    } catch (err) {
      failed++
      errors.push(`${action.type} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { success, failed, errors }
}
