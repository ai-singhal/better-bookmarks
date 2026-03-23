// Supabase Edge Function: semantic-search
// Performs semantic search using pgvector cosine similarity

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
    const { query, limit = 20 } = await req.json()

    if (!query) {
      return Response.json({ error: 'Missing query' }, { status: 400 })
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

    // Generate query embedding
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
      }),
    })

    const embeddingData = await embeddingResponse.json()
    const queryEmbedding = embeddingData.data?.[0]?.embedding

    if (!queryEmbedding) {
      return Response.json({ error: 'Failed to generate query embedding' }, { status: 500 })
    }

    // Search using pgvector
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: results, error } = await supabase.rpc('match_bookmarks', {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: limit,
      p_user_id: user.id,
    })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ results: results || [] })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})
