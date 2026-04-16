-- Fix knowledge_base table: rename last_updated_at to updated_at
-- Run this in Supabase SQL Editor

ALTER TABLE knowledge_base RENAME COLUMN last_updated_at TO updated_at;
