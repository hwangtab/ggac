ALTER TABLE event_applications
  ADD COLUMN IF NOT EXISTS participation_type TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
