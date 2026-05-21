-- Create event_applications table for internal performer/seller sign-ups
-- All writes go through service-role API; all reads go through requireAdmin().
-- RLS is enabled with no permissive policies — direct client access is locked out.

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_slug TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  performance_info TEXT,
  items_to_sell TEXT NOT NULL,
  links TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Status constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_event_application_status'
      AND conrelid = 'public.event_applications'::regclass
  ) THEN
    ALTER TABLE public.event_applications
    ADD CONSTRAINT check_event_application_status
    CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_applications_event_slug
  ON public.event_applications (event_slug);
CREATE INDEX IF NOT EXISTS idx_event_applications_created_at
  ON public.event_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_applications_status
  ON public.event_applications (status);

-- updated_at trigger (reuses existing function from earlier migrations)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_event_applications_updated_at'
      AND tgrelid = 'public.event_applications'::regclass
  ) THEN
    CREATE TRIGGER update_event_applications_updated_at
      BEFORE UPDATE ON public.event_applications
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END$$;

-- Enable RLS — no permissive policies; service-role bypasses RLS
ALTER TABLE public.event_applications ENABLE ROW LEVEL SECURITY;

COMMIT;
