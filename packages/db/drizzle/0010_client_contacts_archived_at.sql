-- Soft-delete marker for artist-initiated disconnect (Settings →
-- Disconnect from a producer). Artist-side queries filter IS NULL so
-- the studio disappears from their switcher / music / store / book;
-- producer-side queries ignore the flag so their CRM keeps history.
ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
