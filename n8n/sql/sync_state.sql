-- Notion → Obsidian sync state (PG 17)
-- Run once before importing the workflow. Take pg_dump before any later schema change.
CREATE TABLE IF NOT EXISTS sync_state (
  page_id      text PRIMARY KEY,
  last_edited  timestamptz,
  content_hash text NOT NULL,
  synced_at    timestamptz NOT NULL DEFAULT now()
);
