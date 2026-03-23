-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Bookmark metadata (supplements Chrome's native bookmark data)
CREATE TABLE bookmark_metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chrome_bookmark_id TEXT,
  url TEXT NOT NULL,
  title TEXT,
  purpose TEXT,
  tags TEXT[] DEFAULT '{}',
  summary TEXT,
  added_at TIMESTAMPTZ DEFAULT now(),
  last_visited_at TIMESTAMPTZ,
  look_at_later BOOLEAN DEFAULT FALSE,
  reminder_at TIMESTAMPTZ,
  reminder_note TEXT,
  reminder_recurring TEXT CHECK (reminder_recurring IN ('daily', 'weekly', 'monthly')),
  source_device TEXT,
  is_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, url)
);

-- Embeddings for semantic search
CREATE TABLE bookmark_embeddings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bookmark_metadata_id UUID REFERENCES bookmark_metadata(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_text TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast vector similarity search
CREATE INDEX bookmark_embeddings_vector_idx ON bookmark_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Organization suggestions
CREATE TABLE organization_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chrome_bookmark_id TEXT NOT NULL,
  bookmark_title TEXT,
  bookmark_url TEXT,
  current_folder_path TEXT,
  suggested_folder_path TEXT,
  reason TEXT,
  confidence FLOAT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX bookmark_metadata_user_id_idx ON bookmark_metadata(user_id);
CREATE INDEX bookmark_metadata_url_idx ON bookmark_metadata(url);
CREATE INDEX bookmark_metadata_look_at_later_idx ON bookmark_metadata(user_id, look_at_later) WHERE look_at_later = TRUE;
CREATE INDEX bookmark_metadata_reminder_idx ON bookmark_metadata(user_id, reminder_at) WHERE reminder_at IS NOT NULL;
CREATE INDEX organization_suggestions_user_status_idx ON organization_suggestions(user_id, status);

-- Row Level Security
ALTER TABLE bookmark_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmark_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own bookmark metadata"
  ON bookmark_metadata FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own embeddings"
  ON bookmark_embeddings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own suggestions"
  ON organization_suggestions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookmark_metadata_updated_at
  BEFORE UPDATE ON bookmark_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Semantic search function
CREATE OR REPLACE FUNCTION match_bookmarks(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 20,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
  id UUID,
  bookmark_metadata_id UUID,
  url TEXT,
  title TEXT,
  summary TEXT,
  tags TEXT[],
  purpose TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    be.id,
    be.bookmark_metadata_id,
    bm.url,
    bm.title,
    bm.summary,
    bm.tags,
    bm.purpose,
    1 - (be.embedding <=> query_embedding) AS similarity
  FROM bookmark_embeddings be
  JOIN bookmark_metadata bm ON be.bookmark_metadata_id = bm.id
  WHERE bm.user_id = p_user_id
    AND 1 - (be.embedding <=> query_embedding) > match_threshold
  ORDER BY be.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
