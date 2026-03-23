import { getSupabaseClient } from '../shared/supabaseClient'
import type { OrganizationSuggestion } from '../shared/types'

export async function analyzeBookmarkOrganization(): Promise<OrganizationSuggestion[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  try {
    const { data, error } = await supabase.functions.invoke('suggest-organization', {
      body: {},
    })

    if (error) {
      console.error('[Organize] Analysis error:', error)
      return []
    }

    return data?.suggestions || []
  } catch (err) {
    console.error('[Organize] Failed:', err)
    return []
  }
}

export async function acceptSuggestion(
  suggestionId: string,
  chromeBookmarkId: string,
  targetFolderId: string
): Promise<boolean> {
  try {
    // Move bookmark in Chrome
    await chrome.bookmarks.move(chromeBookmarkId, { parentId: targetFolderId })

    // Update suggestion status in Supabase
    const supabase = await getSupabaseClient()
    if (supabase) {
      await supabase
        .from('organization_suggestions')
        .update({ status: 'accepted' })
        .eq('id', suggestionId)
    }

    return true
  } catch (err) {
    console.error('[Organize] Accept failed:', err)
    return false
  }
}

export async function dismissSuggestion(suggestionId: string): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) return

  await supabase
    .from('organization_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId)
}
