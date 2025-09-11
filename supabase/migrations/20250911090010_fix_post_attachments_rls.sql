-- Fix post_attachments RLS policies to allow proper file uploads
-- This addresses the issue where authenticated users can't upload files due to strict RLS policies

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "첨부파일 작성" ON public.post_attachments;

-- Create a more flexible policy for file uploads that handles both:
-- 1. Regular post attachments (post must exist and user must be author)  
-- 2. Temporary attachments during rich text editing
CREATE POLICY "첨부파일 작성" ON public.post_attachments
FOR INSERT TO authenticated
WITH CHECK (
  -- Case 1: Temporary attachments for rich text editing
  (
    is_temporary = TRUE 
    AND temp_session IS NOT NULL
    AND expires_at > NOW()
    AND EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  )
  OR
  -- Case 2: Regular post attachments - user must be approved member and either:
  -- a) Post exists and user is the author, OR
  -- b) User is approved member (for immediate upload during post creation)
  (
    (is_temporary = FALSE OR is_temporary IS NULL)
    AND EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
    AND (
      -- Post exists and user is author
      EXISTS (
        SELECT 1 FROM public.posts p 
        WHERE p.id = post_attachments.post_id 
        AND p.author_id = auth.uid()
      )
      OR
      -- For new posts being created, allow if user is approved
      -- (This handles the case where files are uploaded during post creation)
      NOT EXISTS (
        SELECT 1 FROM public.posts p 
        WHERE p.id = post_attachments.post_id
      )
    )
  )
);

-- Add a comment explaining the policy
COMMENT ON POLICY "첨부파일 작성" ON public.post_attachments IS 
'승인된 회원이 자신의 게시글에 첨부파일을 업로드하거나 임시 첨부파일을 업로드할 수 있습니다. 게시글 작성 중 첨부파일 업로드도 허용됩니다.';