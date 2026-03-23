// Supabase Edge Function: summarize-page
// Uses Claude to generate a summary of a web page for a bookmark

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
    const { bookmarkMetadataId, title, url, pageContent } = await req.json()

    if (!bookmarkMetadataId || !url) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get user
    const authHeader = req.headers.get('Authorization')!
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // If no page content provided, try to fetch it
    let content = pageContent
    if (!content) {
      try {
        const pageResponse = await fetch(url, {
          headers: { 'User-Agent': 'AI-Bookmark-Manager/1.0' },
        })
        const html = await pageResponse.text()
        // Extract text between body tags (rough extraction)
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
        content = bodyMatch
          ? bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
          : ''
      } catch {
        content = title || url
      }
    }

    // Generate summary with Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Summarize this web page in 2-3 sentences. Also suggest 3-5 relevant tags.

Title: ${title}
URL: ${url}
Content: ${(content || '').slice(0, 2000)}

Respond in JSON format:
{"summary": "...", "suggested_tags": ["tag1", "tag2", "tag3"]}`,
          },
        ],
      }),
    })

    const aiResult = await response.json()
    const aiText = aiResult.content?.[0]?.text || '{}'

    let summary = ''
    let suggestedTags: string[] = []
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        summary = parsed.summary || ''
        suggestedTags = parsed.suggested_tags || []
      }
    } catch {
      summary = aiText.slice(0, 300)
    }

    // Update bookmark metadata with summary
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    await supabase
      .from('bookmark_metadata')
      .update({ summary, tags: suggestedTags })
      .eq('id', bookmarkMetadataId)

    return Response.json({ summary, suggestedTags })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})
