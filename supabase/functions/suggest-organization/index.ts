// Supabase Edge Function: suggest-organization
// Uses AI to analyze bookmark organization and suggest improvements

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const { folderStructure } = await req.json()

    // Get user
    const authHeader = req.headers.get('Authorization')!
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all user bookmarks with metadata
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: allBookmarks } = await supabase
      .from('bookmark_metadata')
      .select('*')
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })
      .limit(200)

    if (!allBookmarks || allBookmarks.length === 0) {
      return Response.json({ suggestions: [] })
    }

    // Call Claude API for organization analysis
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `Analyze these bookmarks and suggest reorganization. For each bookmark that seems misplaced or could be better organized, suggest a better folder.

Folder structure:
${JSON.stringify(folderStructure, null, 2)}

Bookmarks with current folders:
${JSON.stringify(
  allBookmarks.map((b: Record<string, unknown>) => ({
    title: b.title,
    url: b.url,
    tags: b.tags,
    summary: b.summary,
  })),
  null,
  2
)}

Respond with a JSON array of suggestions:
[{
  "bookmark_url": "...",
  "bookmark_title": "...",
  "current_folder": "...",
  "suggested_folder": "...",
  "reason": "...",
  "confidence": 0.0-1.0
}]

Only suggest changes where you're fairly confident (confidence > 0.6). Focus on clearly misplaced bookmarks.`,
          },
        ],
      }),
    })

    const aiResult = await response.json()
    const aiText = aiResult.content?.[0]?.text || '[]'

    // Parse suggestions from AI response
    let suggestions = []
    try {
      const jsonMatch = aiText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0])
      }
    } catch {
      console.error('Failed to parse AI suggestions')
    }

    // Store suggestions
    if (suggestions.length > 0) {
      const rows = suggestions.map((s: Record<string, unknown>) => ({
        user_id: user.id,
        chrome_bookmark_id: '',
        bookmark_title: s.bookmark_title,
        bookmark_url: s.bookmark_url,
        current_folder_path: s.current_folder,
        suggested_folder_path: s.suggested_folder,
        reason: s.reason,
        confidence: s.confidence,
        status: 'pending',
      }))

      await supabase.from('organization_suggestions').insert(rows)
    }

    return Response.json({ suggestions })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})
