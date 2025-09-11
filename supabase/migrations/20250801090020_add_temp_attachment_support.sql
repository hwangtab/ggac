-- Add temporary attachment support to existing post_attachments table
-- This allows temporary images uploaded during rich text editing

-- Add columns for temporary attachment management
ALTER TABLE public.post_attachments 
ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS temp_session TEXT,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient cleanup of expired temporary attachments
CREATE INDEX IF NOT EXISTS idx_post_attachments_temp_cleanup 
ON public.post_attachments(is_temporary, expires_at) 
WHERE is_temporary = TRUE;

-- Create index for temporary session lookups
CREATE INDEX IF NOT EXISTS idx_post_attachments_temp_session 
ON public.post_attachments(temp_session) 
WHERE is_temporary = TRUE;

-- Update RLS policies to handle temporary attachments
-- Drop existing policies if they exist (ignore errors if they don't exist)
DROP POLICY IF EXISTS "Users can upload temporary attachments" ON public.post_attachments;
DROP POLICY IF EXISTS "Users can view own temporary attachments" ON public.post_attachments;

-- Allow users to upload temporary attachments with their session
CREATE POLICY "Users can upload temporary attachments" ON public.post_attachments
FOR INSERT WITH CHECK (
  is_temporary = TRUE 
  AND temp_session IS NOT NULL
  AND expires_at > NOW()
  AND (
    -- Allow if user is approved member
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  )
);

-- Allow users to view their own temporary attachments
CREATE POLICY "Users can view own temporary attachments" ON public.post_attachments
FOR SELECT USING (
  (is_temporary = TRUE AND temp_session = auth.uid()::text)
  OR is_temporary = FALSE -- Regular attachments follow existing policies
);

-- Function to cleanup expired temporary attachments
CREATE OR REPLACE FUNCTION cleanup_expired_temp_attachments()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.post_attachments
  WHERE is_temporary = TRUE 
  AND expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log cleanup activity
  INSERT INTO public.system_logs (action, details, created_at)
  VALUES ('temp_attachments_cleanup', jsonb_build_object('deleted_count', deleted_count), NOW())
  ON CONFLICT DO NOTHING; -- Ignore if system_logs table doesn't exist
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON COLUMN public.post_attachments.is_temporary IS 'True if this is a temporary attachment uploaded during editing';
COMMENT ON COLUMN public.post_attachments.temp_session IS 'Session identifier for temporary attachments';
COMMENT ON COLUMN public.post_attachments.expires_at IS 'Expiration time for temporary attachments (cleanup after 24 hours)';
COMMENT ON FUNCTION cleanup_expired_temp_attachments() IS 'Cleanup function for expired temporary attachments - should be called regularly via cron job';