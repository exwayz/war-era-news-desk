-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql/new)

-- 1. Create the messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint * 1000,
  upvotes INTEGER NOT NULL DEFAULT 0,
  upvoters TEXT[] NOT NULL DEFAULT '{}',
  posted_by TEXT NOT NULL DEFAULT ''
);

-- 2. Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 3. Allow anyone to read messages (SELECT)
CREATE POLICY "allow_select" ON messages
  FOR SELECT USING (true);

-- 4. Allow anyone to insert messages (INSERT)
CREATE POLICY "allow_insert" ON messages
  FOR INSERT WITH CHECK (true);

-- 5. Allow anyone to update upvotes and upvoters only (UPDATE)
CREATE POLICY "allow_upvote" ON messages
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- 6. Function: post with 5/week rate limit per posted_by hash
CREATE OR REPLACE FUNCTION post_message(p_author TEXT, p_text TEXT, p_posted_by TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  recent_count INTEGER;
  new_msg JSONB;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM messages
  WHERE posted_by = p_posted_by
    AND created_at > (extract(epoch from now()) * 1000 - 7*24*60*60*1000)::bigint;

  IF recent_count >= 5 THEN
    RETURN jsonb_build_object('error', 'Post limit reached (5/week)');
  END IF;

  INSERT INTO messages (author, text, created_at, upvotes, upvoters, posted_by)
  VALUES (p_author, p_text, (extract(epoch from now()) * 1000)::bigint, 0, '{}', p_posted_by)
  RETURNING row_to_json(messages.*)::jsonb INTO new_msg;

  RETURN new_msg;
END;
$$;
