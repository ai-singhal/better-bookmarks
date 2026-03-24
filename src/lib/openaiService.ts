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

interface AIQueryOptions {
  additionalContext?: string
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

function collectBookmarkIds(nodes: BookmarkWithMetadata[]): Set<string> {
  const ids = new Set<string>()

  for (const node of nodes) {
    if (node.url) {
      ids.add(node.id)
      continue
    }

    if (node.children?.length) {
      for (const child of node.children) {
        if (child.url) {
          ids.add(child.id)
        } else if (child.children?.length) {
          for (const nestedId of collectBookmarkIds([child])) {
            ids.add(nestedId)
          }
        }
      }
    }
  }

  return ids
}

// ─── System Prompt ───

function buildSystemPrompt(bookmarkTree: string, additionalContext?: string): string {
  const extraContext = additionalContext?.trim()
    ? `## Additional Context
${additionalContext.trim()}

`
    : ''

  return `You are an AI assistant that manages Chrome bookmarks. You have access to the user's full bookmark tree and can execute actions on it.

## Bookmark Tree
The tree uses this format:
- [F:id] Folder Name (N bookmarks) = folder with ID
- [B:id] Title | URL = bookmark with ID
Indentation shows nesting.

${bookmarkTree}

${extraContext}## Your Capabilities
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
- Use "searchResults" only when the user explicitly wants matching bookmarks listed or opened.
- Do not use "searchResults" for plans, previews, folder structures, or proposed reorganizations. Put those details in "message" and in executable actions if changes are requested.
- Never put folder IDs or made-up IDs in "searchResults". They must always be real bookmark IDs.
- For move/organize requests, generate the actual move actions with real IDs from the tree
- When the user asks to preview a reorganization before applying it, include the proposed folder structure or ordering plan directly in the "message" field and also include the planned actions in the "actions" array. The UI will not execute them until the user confirms.
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

function sanitizeAIResponse(response: AIResponse, bookmarkTree: BookmarkWithMetadata[]): AIResponse {
  const validBookmarkIds = collectBookmarkIds(bookmarkTree[0]?.children || bookmarkTree)

  const sanitizedSearchResults = (response.searchResults || []).filter((result) =>
    validBookmarkIds.has(result.bookmarkId)
  )

  const sanitizedActions = response.actions
    .map((action) => {
      if (action.type !== 'search_results') return action
      const bookmarkIds = (action.bookmarkIds || []).filter((bookmarkId) => validBookmarkIds.has(bookmarkId))
      return bookmarkIds.length > 0
        ? { ...action, bookmarkIds }
        : null
    })
    .filter((action): action is AIAction => action !== null)

  return {
    ...response,
    actions: sanitizedActions,
    searchResults: sanitizedSearchResults.length > 0 ? sanitizedSearchResults : undefined,
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
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  options: AIQueryOptions = {}
): Promise<AIResponse> {
  const apiKey = await getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add it in the settings below.')
  }

  const rootChildren = bookmarkTree[0]?.children || bookmarkTree
  const serialized = serializeBookmarkTree(rootChildren)
  const systemPrompt = buildSystemPrompt(serialized, options.additionalContext)

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

  return sanitizeAIResponse(parseAIResponseContent(content), bookmarkTree)
}

export async function streamAI(
  prompt: string,
  bookmarkTree: BookmarkWithMetadata[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  callbacks: AIStreamCallbacks = {},
  options: AIQueryOptions = {}
): Promise<AIResponse> {
  const apiKey = await getOpenAIKey()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add it in the settings below.')
  }

  const rootChildren = bookmarkTree[0]?.children || bookmarkTree
  const serialized = serializeBookmarkTree(rootChildren)
  const systemPrompt = buildSystemPrompt(serialized, options.additionalContext)
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
    return queryAI(prompt, bookmarkTree, conversationHistory, options)
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

  const parsed = sanitizeAIResponse(parseAIResponseContent(rawContent), bookmarkTree)
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
  let createdFolderCount = 0

  // Track placeholder folder IDs → real IDs
  const folderIdMap = new Map<string, string>()

  const readBookmarkState = async () => {
    const tree = await chrome.bookmarks.getTree()
    const nodeIds = new Set<string>()
    const folderIds = new Set<string>()

    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
      for (const node of nodes) {
        nodeIds.add(node.id)
        if (node.children) {
          folderIds.add(node.id)
          walk(node.children)
        }
      }
    }

    walk(tree)
    return { nodeIds, folderIds }
  }

  let bookmarkState = await readBookmarkState()

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
          if (!bookmarkState.folderIds.has(parentId)) {
            failed++
            errors.push(`create_folder skipped: parent folder "${parentId}" does not exist`)
            break
          }
          const result = await chrome.bookmarks.create({
            parentId,
            title: action.title || 'New Folder',
          })
          // Map placeholder to real ID if present
          if (action.bookmarkId) {
            folderIdMap.set(action.bookmarkId, result.id)
          }
          // Also map common placeholder patterns
          createdFolderCount += 1
          const placeholderKey = `new_${createdFolderCount}`
          folderIdMap.set(placeholderKey, result.id)
          bookmarkState = await readBookmarkState()
          onProgress?.(i + 1, actions.length, `Created folder "${action.title}"`)
          success++
          break
        }
        case 'move': {
          const bookmarkId = resolveId(action.bookmarkId)
          const destId = resolveId(action.destinationFolderId)
          if (!bookmarkId || !bookmarkState.nodeIds.has(bookmarkId)) {
            failed++
            errors.push(`move skipped: bookmark "${action.bookmarkId}" does not exist`)
            break
          }
          if (!destId || !bookmarkState.folderIds.has(destId)) {
            failed++
            errors.push(`move skipped: destination folder "${action.destinationFolderId}" does not exist`)
            break
          }
          if (bookmarkId && destId) {
            await chrome.bookmarks.move(bookmarkId, { parentId: destId })
            bookmarkState = await readBookmarkState()
            onProgress?.(i + 1, actions.length, `Moved bookmark`)
            success++
          }
          break
        }
        case 'reorder': {
          const bookmarkId = resolveId(action.bookmarkId)
          const parentId = resolveId(action.parentId)
          if (!bookmarkId || !bookmarkState.nodeIds.has(bookmarkId)) {
            failed++
            errors.push(`reorder skipped: bookmark "${action.bookmarkId}" does not exist`)
            break
          }
          if (!parentId || !bookmarkState.folderIds.has(parentId)) {
            failed++
            errors.push(`reorder skipped: parent folder "${action.parentId}" does not exist`)
            break
          }
          if (bookmarkId && parentId && action.index !== undefined) {
            await chrome.bookmarks.move(bookmarkId, {
              parentId,
              index: action.index,
            })
            bookmarkState = await readBookmarkState()
            onProgress?.(i + 1, actions.length, `Reordered bookmark`)
            success++
          }
          break
        }
        case 'delete': {
          const bookmarkId = resolveId(action.bookmarkId)
          if (!bookmarkId || !bookmarkState.nodeIds.has(bookmarkId)) {
            failed++
            errors.push(`delete skipped: bookmark "${action.bookmarkId}" does not exist`)
            break
          }
          if (bookmarkId) {
            try {
              await chrome.bookmarks.remove(bookmarkId)
            } catch {
              // Try removeTree for folders
              await chrome.bookmarks.removeTree(bookmarkId)
            }
            bookmarkState = await readBookmarkState()
            onProgress?.(i + 1, actions.length, `Deleted bookmark`)
            success++
          }
          break
        }
        case 'rename': {
          const bookmarkId = resolveId(action.bookmarkId)
          if (!bookmarkId || !bookmarkState.nodeIds.has(bookmarkId)) {
            failed++
            errors.push(`rename skipped: bookmark "${action.bookmarkId}" does not exist`)
            break
          }
          if (bookmarkId && action.title) {
            await chrome.bookmarks.update(bookmarkId, { title: action.title })
            bookmarkState = await readBookmarkState()
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
