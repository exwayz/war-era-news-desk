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
