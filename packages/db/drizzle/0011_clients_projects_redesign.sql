-- Clients & Projects v3 redesign — Phase 0 migrations.
-- Design: docs/plans/active/2026-05-14-clients-projects-redesign-design.md
-- All additive. Old project.stage enum is preserved.

-- 1. New enum: workflow_stage (5 values)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_stage') THEN
    CREATE TYPE workflow_stage AS ENUM (
      'brief',
      'production',
      'mixing',
      'mastering',
      'done'
    );
  END IF;
END$$;

-- 2. client_contacts.invited_at — linkpill "Invited" state
ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

-- 3. client_contacts.position — drag-reorder slot
ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- 4. projects.position — drag-reorder slot
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- 5. projects.workflow_stage — new creative stage (parallel to legacy stage)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS workflow_stage workflow_stage NOT NULL DEFAULT 'brief';

-- 6. project_tracks.workflow_stage — per-song creative stage
ALTER TABLE project_tracks
  ADD COLUMN IF NOT EXISTS workflow_stage workflow_stage NOT NULL DEFAULT 'brief';

-- 7. bookings.song_id — link a session to a specific song
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS song_id uuid REFERENCES project_tracks(id) ON DELETE SET NULL;
