-- Add rich content support to posts table
-- This migration adds support for HTML content format

-- Add content_format column to distinguish between plain text and HTML
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS content_format VARCHAR(20) DEFAULT 'plain';

-- Create table for embedded images tracking
CREATE TABLE IF NOT EXISTS public.post_embedded_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  position_index INTEGER,
  file_size BIGINT,
  mime_type VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_post_embedded_images_post_id ON public.post_embedded_images(post_id);
CREATE INDEX IF NOT EXISTS idx_post_embedded_images_position ON public.post_embedded_images(post_id, position_index);

-- RLS policies for post_embedded_images
ALTER TABLE public.post_embedded_images ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (ignore errors if they don't exist)
DROP POLICY IF EXISTS "Approved members can view embedded images" ON public.post_embedded_images;
DROP POLICY IF EXISTS "Post authors can manage embedded images" ON public.post_embedded_images;
DROP POLICY IF EXISTS "Admins can manage all embedded images" ON public.post_embedded_images;

-- Allow approved members to view embedded images
CREATE POLICY "Approved members can view embedded images" ON public.post_embedded_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

-- Allow post authors to manage their embedded images
CREATE POLICY "Post authors can manage embedded images" ON public.post_embedded_images
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_embedded_images.post_id 
      AND posts.author_id = auth.uid()
    )
  );

-- Allow admins to manage all embedded images
CREATE POLICY "Admins can manage all embedded images" ON public.post_embedded_images
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.is_admin = true
      AND member_profiles.is_active = true
      AND member_profiles.registration_status = 'approved'
    )
  );

-- Add comments to new columns
COMMENT ON COLUMN public.posts.content_format IS 'Format of post content: plain, html, markdown';
COMMENT ON TABLE public.post_embedded_images IS 'Track images embedded within post content';
COMMENT ON COLUMN public.post_embedded_images.position_index IS 'Order of image appearance in post content';