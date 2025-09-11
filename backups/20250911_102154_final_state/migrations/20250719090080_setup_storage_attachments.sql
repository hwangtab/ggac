-- Supabase Storage attachments bucket 및 정책 설정

-- attachments bucket 생성 (수동으로 생성해야 할 수도 있음)
-- INSERT INTO storage.buckets (id, name, public) 
-- VALUES ('attachments', 'attachments', true);

-- Storage RLS 정책 설정
-- 이 정책들은 Supabase 대시보드에서 Storage 설정을 통해 적용해야 할 수도 있습니다.

-- 1. 공개 읽기 정책 (모든 인증된 사용자)
-- CREATE POLICY "첨부파일 공개 읽기" ON storage.objects
--   FOR SELECT TO authenticated, anon
--   USING (bucket_id = 'attachments');

-- 2. 업로드 정책 (승인된 회원만)
-- CREATE POLICY "첨부파일 업로드" ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'attachments' AND
--     EXISTS (
--       SELECT 1 FROM member_profiles 
--       WHERE id = auth.uid() 
--       AND registration_status = 'approved' 
--       AND is_active = true
--     )
--   );

-- 3. 삭제 정책 (파일 소유자 또는 관리자)
-- CREATE POLICY "첨부파일 삭제" ON storage.objects
--   FOR DELETE TO authenticated
--   USING (
--     bucket_id = 'attachments' AND (
--       -- 파일 소유자인지 확인 (경로에서 추출)
--       (storage.foldername(name))[2] IN (
--         SELECT p.id::text FROM posts p WHERE p.author_id = auth.uid()
--       ) OR
--       -- 관리자인지 확인
--       EXISTS (
--         SELECT 1 FROM member_profiles 
--         WHERE id = auth.uid() 
--         AND is_admin = true
--       )
--     )
--   );

-- 4. 업데이트 정책 (파일 소유자만)
-- CREATE POLICY "첨부파일 업데이트" ON storage.objects
--   FOR UPDATE TO authenticated
--   USING (
--     bucket_id = 'attachments' AND
--     (storage.foldername(name))[2] IN (
--       SELECT p.id::text FROM posts p WHERE p.author_id = auth.uid()
--     )
--   );

-- Storage bucket이 존재하지 않을 경우를 대비한 함수
CREATE OR REPLACE FUNCTION ensure_attachments_bucket_exists()
RETURNS BOOLEAN AS $$
DECLARE
  bucket_exists BOOLEAN;
BEGIN
  -- bucket 존재 여부 확인
  SELECT EXISTS(
    SELECT 1 FROM storage.buckets WHERE id = 'attachments'
  ) INTO bucket_exists;
  
  -- bucket이 없으면 생성 시도 (권한이 있는 경우에만 가능)
  IF NOT bucket_exists THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'attachments', 
        'attachments', 
        true,
        52428800, -- 50MB
        ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
              'application/pdf', 'application/msword', 
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'video/mp4', 'video/webm', 'video/ogg',
              'audio/mpeg', 'audio/wav', 'audio/ogg']
      );
      RETURN TRUE;
    EXCEPTION WHEN OTHERS THEN
      -- bucket 생성 실패 시 false 반환
      RETURN FALSE;
    END;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- bucket 존재 확인 및 생성 시도
SELECT ensure_attachments_bucket_exists();

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION ensure_attachments_bucket_exists TO service_role;

-- 첨부파일 정보 확인을 위한 뷰 생성
CREATE OR REPLACE VIEW post_attachments_with_stats AS
SELECT 
  pa.*,
  p.title as post_title,
  p.author_id as post_author_id,
  mp.display_name as author_name,
  -- 파일 정보 통계
  CASE 
    WHEN pa.file_size < 1024 THEN pa.file_size || ' B'
    WHEN pa.file_size < 1024*1024 THEN ROUND(pa.file_size/1024.0, 1) || ' KB'
    WHEN pa.file_size < 1024*1024*1024 THEN ROUND(pa.file_size/(1024.0*1024), 1) || ' MB'
    ELSE ROUND(pa.file_size/(1024.0*1024*1024), 1) || ' GB'
  END as file_size_formatted
FROM post_attachments pa
JOIN posts p ON pa.post_id = p.id
JOIN member_profiles mp ON p.author_id = mp.id;

-- 뷰에 대한 RLS 정책
ALTER VIEW post_attachments_with_stats SET (security_barrier = true);

-- 뷰 권한 설정
GRANT SELECT ON post_attachments_with_stats TO authenticated;

-- 코멘트 추가
COMMENT ON FUNCTION ensure_attachments_bucket_exists IS 'Storage attachments bucket 존재 확인 및 생성 함수';
COMMENT ON VIEW post_attachments_with_stats IS '첨부파일 정보와 통계를 포함한 뷰';

-- 추가 유틸리티 함수: 게시글의 첨부파일 크기 합계
CREATE OR REPLACE FUNCTION get_post_total_attachment_size(p_post_id UUID)
RETURNS BIGINT AS $$
DECLARE
  total_size BIGINT;
BEGIN
  SELECT COALESCE(SUM(file_size), 0)
  INTO total_size
  FROM post_attachments
  WHERE post_id = p_post_id;
  
  RETURN total_size;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_post_total_attachment_size TO authenticated;