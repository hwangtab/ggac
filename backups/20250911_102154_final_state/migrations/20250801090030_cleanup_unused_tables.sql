-- Clean up unused post_embedded_images table
-- This migration removes the post_embedded_images table that was created but never used
-- All inline image functionality is handled through the existing post_attachments table

-- Drop policies first
DROP POLICY IF EXISTS "Approved members can view embedded images" ON public.post_embedded_images;
DROP POLICY IF EXISTS "Post authors can manage embedded images" ON public.post_embedded_images;
DROP POLICY IF EXISTS "Admins can manage all embedded images" ON public.post_embedded_images;

-- Drop indexes
DROP INDEX IF EXISTS public.idx_post_embedded_images_post_id;
DROP INDEX IF EXISTS public.idx_post_embedded_images_position;

-- Drop the table
DROP TABLE IF EXISTS public.post_embedded_images;

-- Add comment explaining the cleanup
COMMENT ON COLUMN public.posts.content_format IS 'Format of post content: plain, html, markdown. Inline images are stored in post_attachments table.';