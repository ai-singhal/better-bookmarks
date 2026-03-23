import { getSupabaseClient } from '../shared/supabaseClient'
import { flattenBookmarks, getBookmarkTree } from '../shared/chromeApi'
import type { BookmarkMetadata } from '../shared/types'

export async function syncAllBookmarks(): Promise<{ synced: number; errors: number }> {
  const supabase = await getSupabaseClient()
  if (!supabase) return { synced: 0, errors: 0 }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { synced: 0, errors: 0 }

  const tree = await getBookmarkTree()
  const bookmarks = flattenBookmarks(tree)

  let synced = 0
  let errors = 0

  // Process in batches of 50
  for (let i = 0; i < bookmarks.length; i += 50) {
    const batch = bookmarks.slice(i, i + 50)
    const rows = batch
      .filter((b) => b.url)
      .map((b) => ({
        user_id: user.id,
        chrome_bookmark_id: b.id,
        url: b.url!,
        title: b.title,
        added_at: b.dateAdded ? new Date(b.dateAdded).toISOString() : new Date().toISOString(),
        source_device: detectDevice(),
      }))

    const { error } = await supabase
      .from('bookmark_metadata')
      .upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: false })

    if (error) {
      console.error('[Sync] Batch error:', error)
      errors += batch.length
    } else {
      synced += rows.length
    }
  }

  console.log(`[Sync] Complete: ${synced} synced, ${errors} errors`)
  return { synced, errors }
}

export async function syncSingleBookmark(
  chromeBookmarkId: string,
  url: string,
  title: string
): Promise<BookmarkMetadata | null> {
  const supabase = await getSupabaseClient()
  if (!supabase) return null

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('bookmark_metadata')
    .upsert(
      {
        user_id: user.id,
        chrome_bookmark_id: chromeBookmarkId,
        url,
        title,
        added_at: new Date().toISOString(),
        source_device: detectDevice(),
      },
      { onConflict: 'user_id,url' }
    )
    .select()
    .single()

  if (error) {
    console.error('[Sync] Single bookmark error:', error)
    return null
  }

  return data as BookmarkMetadata
}

export async function removeBookmarkMetadata(url: string): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('bookmark_metadata')
    .delete()
    .eq('user_id', user.id)
    .eq('url', url)
}

export async function updateBookmarkPurpose(
  url: string,
  purpose: string,
  tags: string[]
): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('bookmark_metadata')
    .update({ purpose, tags, is_processed: true })
    .eq('user_id', user.id)
    .eq('url', url)
}

export async function setLookAtLater(
  url: string,
  lookAtLater: boolean,
  reminderAt?: string,
  reminderNote?: string
): Promise<void> {
  const supabase = await getSupabaseClient()
  if (!supabase) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('bookmark_metadata')
    .update({
      look_at_later: lookAtLater,
      reminder_at: reminderAt || null,
      reminder_note: reminderNote || null,
    })
    .eq('user_id', user.id)
    .eq('url', url)
}

export async function getUnprocessedBookmarks(): Promise<BookmarkMetadata[]> {
  const supabase = await getSupabaseClient()
  if (!supabase) return []

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('bookmark_metadata')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_processed', false)
    .order('added_at', { ascending: false })
    .limit(50)

  return (data as BookmarkMetadata[]) || []
}

function detectDevice(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile'
  }
  return 'desktop'
}
