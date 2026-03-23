// Supabase Edge Function: generate-embedding
// Generates an embedding for a bookmark using OpenAI and stores it in pgvector

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
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
    const { bookmarkMetadataId, contentText } = await req.json()

    if (!bookmarkMetadataId || !contentText) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Generate embedding via OpenAI
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: contentText.slice(0, 8000), // Limit input length
      }),
    })

    const embeddingData = await embeddingResponse.json()
    const embedding = embeddingData.data?.[0]?.embedding

    if (!embedding) {
      return Response.json({ error: 'Failed to generate embedding' }, { status: 500 })
    }

    // Store in database
    const { error } = await supabaseClient
      .from('bookmark_embeddings')
      .upsert(
        {
          bookmark_metadata_id: bookmarkMetadataId,
          user_id: user.id,
          content_text: contentText.slice(0, 2000),
          embedding,
        },
        { onConflict: 'bookmark_metadata_id' }
      )

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    // Mark metadata as processed
    await supabaseClient
      .from('bookmark_metadata')
      .update({ is_processed: true })
      .eq('id', bookmarkMetadataId)

    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})
