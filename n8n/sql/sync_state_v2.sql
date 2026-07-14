-- Notion → Obsidian sync state v2 (Phase 2: block content + OKF index)
-- Run on Tab S9 AFTER pg_dump (SENTINEL rule ⑤: schema change requires backup first).
--   pg_dump -h <host> -U <role> -d <db> -f backup_before_sync_state_v2_$(date +%Y%m%d).sql
-- slug is not in the original v5.8 Phase 2 design note but is required to build index.md links
-- (each row needs to know its own filename) -- added here rather than recomputing slugify()
-- a second time in a separate node.
ALTER TABLE public.sync_state
  ADD COLUMN IF NOT EXISTS title   text,
  ADD COLUMN IF NOT EXISTS slug    text,
  ADD COLUMN IF NOT EXISTS folder  text,
  ADD COLUMN IF NOT EXISTS summary text;
