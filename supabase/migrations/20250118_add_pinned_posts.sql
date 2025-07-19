-- Add pinned posts functionality to posts table
-- This migration adds columns for post pinning feature

-- Add is_pinned column
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Add pinned_at column
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP WITH TIME ZONE;

-- Create index for pinned posts query performance
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON public.posts(is_pinned, pinned_at DESC) WHERE is_pinned = true;

-- Create index for category and pinned status (for announcement pinning)
CREATE INDEX IF NOT EXISTS idx_posts_category_pinned ON public.posts(category, is_pinned, created_at DESC);

-- Update RLS policies to allow admins to manage pinned posts
CREATE POLICY IF NOT EXISTS "Admins can manage pinned posts" ON public.posts 
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

-- Comment on new columns
COMMENT ON COLUMN public.posts.is_pinned IS 'Whether the post is pinned (공지사항 only)';
COMMENT ON COLUMN public.posts.pinned_at IS 'When the post was pinned';
