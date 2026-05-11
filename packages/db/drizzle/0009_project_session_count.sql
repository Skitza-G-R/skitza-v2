-- Add session_count to projects: snapshot of the product's session count
-- so future bookings within the same project skip payment as long as
-- count(confirmed bookings) < session_count. Nullable for legacy rows;
-- defaults to 1 (single-session) for backwards compatibility.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS session_count integer DEFAULT 1;
