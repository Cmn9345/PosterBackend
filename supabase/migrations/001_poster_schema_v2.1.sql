-- Migration: poster_schema_v2.1
-- Date: 2026-04-12
-- Description: Add ai_analysis, metadata, and Immich sync columns to poster_files.
--              Add new processing_status values for the 5-step pipeline.

-- ============================================================
-- poster_files: Add columns for AI analysis and Immich sync
-- ============================================================

-- AI analysis results from VLM (OCR, themes, description)
ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS ai_analysis JSONB DEFAULT NULL;

-- Technical metadata (EXIF, dimensions, DPI, layers)
ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- Immich integration fields
ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS immich_asset_id TEXT DEFAULT NULL;

ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS immich_sync_status TEXT DEFAULT NULL;

ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS immich_synced_at TIMESTAMPTZ DEFAULT NULL;

-- Who created this file record
ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT NULL;

-- Ensure created_at exists
ALTER TABLE poster_files
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- Update processing_status CHECK constraint
-- Old: uploaded, processing, completed, failed
-- New: uploaded, processing, metadata_ready, analysis_skipped,
--      completed, syncing, synced, sync_failed, failed, rejected
-- ============================================================

-- Drop old constraint if exists, then add new one
DO $$
BEGIN
  -- Try to drop old constraint (may not exist)
  BEGIN
    ALTER TABLE poster_files DROP CONSTRAINT IF EXISTS poster_files_processing_status_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Add new constraint with all valid states
  ALTER TABLE poster_files
    ADD CONSTRAINT poster_files_processing_status_check
    CHECK (processing_status IN (
      'uploaded',
      'processing',
      'metadata_ready',
      'analysis_skipped',
      'completed',
      'syncing',
      'synced',
      'sync_failed',
      'failed',
      'rejected'
    ));
END $$;

-- ============================================================
-- posters: Ensure status column supports all states
-- ============================================================

DO $$
BEGIN
  BEGIN
    ALTER TABLE posters DROP CONSTRAINT IF EXISTS posters_status_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ALTER TABLE posters
    ADD CONSTRAINT posters_status_check
    CHECK (status IN (
      'draft',
      'uploading',
      'processing',
      'pending_review',
      'approved',
      'rejected',
      'published',
      'archived'
    ));
END $$;

-- Ensure created_by on posters
ALTER TABLE posters
  ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT NULL;

-- ============================================================
-- Indexes for CoPaw poll queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_poster_files_processing_status
  ON poster_files (processing_status)
  WHERE processing_status = 'uploaded';

CREATE INDEX IF NOT EXISTS idx_poster_files_poster_id
  ON poster_files (poster_id);

CREATE INDEX IF NOT EXISTS idx_posters_status
  ON posters (status);

CREATE INDEX IF NOT EXISTS idx_posters_updated_at
  ON posters (updated_at);

-- ============================================================
-- H6: Table alignment — poster_projects is a legacy alias for posters
-- The Rust backend previously used poster_projects, now unified to posters.
-- Create a view as alias for any remaining references.
-- ============================================================

CREATE OR REPLACE VIEW poster_projects AS SELECT * FROM posters;

-- ============================================================
-- Comment
-- ============================================================

COMMENT ON COLUMN poster_files.ai_analysis IS 'VLM analysis result: {ocr_text, themes, description, language, has_logo, has_person}';
COMMENT ON COLUMN poster_files.metadata IS 'Technical metadata: {width, height, dpi, format, mode, exif, layer_count, page_count}';
COMMENT ON COLUMN poster_files.immich_asset_id IS 'Immich asset ID after sync';
COMMENT ON COLUMN poster_files.immich_sync_status IS 'Immich sync status: synced, failed';
