import { getSupabaseClient } from '../shared/supabaseClient'

export async function generateAndStoreEmbedding(
  bookmarkMetadataId: string,
  contentText: string
): Promise<boolean> {
  const supabase = await getSupabaseClient()
  if (!supabase) return false

  try {
    const { data, error } = await supabase.functions.invoke('generate-embedding', {
      body: {
        bookmarkMetadataId,
        contentText,
      },
    })

    if (error) {
      console.error('[Embeddings] Generation error:', error)
      return false
    }

    return data?.success === true
  } catch (err) {
    console.error('[Embeddings] Failed:', err)
    return false
  }
}

export async function semanticSearch(
  query: string,
  limit = 20
): Promise<SemanticSearchResult[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase.functions.invoke('semantic-search', {
      body: { query, limit },
    })

    if (error) {
      console.error('[Search] Semantic search error:', error)
      return []
    }

    return data?.results || []
  } catch (err) {
    console.error('[Search] Failed:', err)
    return []
  }
}

export async function batchGenerateEmbeddings(
  bookmarks: Array<{ metadataId: string; contentText: string }>
): Promise<{ processed: number; errors: number }> {
  let processed = 0
  let errors = 0

  for (const bookmark of bookmarks) {
    const success = await generateAndStoreEmbedding(
      bookmark.metadataId,
      bookmark.contentText
    )
    if (success) processed++
    else errors++

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return { processed, errors }
}

interface SemanticSearchResult {
  id: string
  bookmark_metadata_id: string
  url: string
  title: string
  summary: string
  tags: string[]
  purpose: string
  similarity: number
}
