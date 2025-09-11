-- 아티스트 프로필 사진 Storage 정책 설정
-- 기존 정책 삭제 후 새로 생성

-- 기존 정책들 모두 삭제 (존재하는 경우)
DROP POLICY IF EXISTS "artist_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "artist_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "artist_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "artist_photos_delete" ON storage.objects;

-- 한국어 이름 정책도 삭제 (혹시 존재하는 경우)
DROP POLICY IF EXISTS "아티스트 프로필 사진 공개 읽기" ON storage.objects;
DROP POLICY IF EXISTS "아티스트 프로필 사진 업로드" ON storage.objects;
DROP POLICY IF EXISTS "아티스트 프로필 사진 업데이트" ON storage.objects;
DROP POLICY IF EXISTS "아티스트 프로필 사진 삭제" ON storage.objects;

-- 기타 아티스트 관련 정책들도 정리
DROP POLICY IF EXISTS "Artist profile photo public read" ON storage.objects;
DROP POLICY IF EXISTS "Artist profile photo upload" ON storage.objects;
DROP POLICY IF EXISTS "Artist profile photo update" ON storage.objects;
DROP POLICY IF EXISTS "Artist profile photo delete" ON storage.objects;

-- 새로운 정책 생성

-- 1. 공개 읽기 정책 (모든 사용자가 아티스트 프로필 사진 읽기 가능)
CREATE POLICY "artist_photos_public_read" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'artists');

-- 2. 업로드 정책 (아티스트 권한이 있는 승인된 사용자만 업로드 가능)
CREATE POLICY "artist_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'artists' AND
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND registration_status = 'approved' 
      AND is_active = true
      AND is_artist = true
    )
  );

-- 3. 업데이트 정책 (아티스트 권한이 있는 승인된 사용자만 수정 가능)
CREATE POLICY "artist_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'artists' AND
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND registration_status = 'approved' 
      AND is_active = true
      AND is_artist = true
    )
  );

-- 4. 삭제 정책 (아티스트 또는 관리자만 삭제 가능)
CREATE POLICY "artist_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'artists' AND (
      EXISTS (
        SELECT 1 FROM member_profiles 
        WHERE id = auth.uid() 
        AND registration_status = 'approved' 
        AND is_active = true
        AND is_artist = true
      ) OR
      EXISTS (
        SELECT 1 FROM member_profiles 
        WHERE id = auth.uid() 
        AND is_admin = true
      )
    )
  );

-- 정책 생성 확인을 위한 뷰 (선택사항)
-- CREATE OR REPLACE VIEW artist_storage_policies AS
-- SELECT 
--   policyname, 
--   cmd,
--   roles,
--   CASE 
--     WHEN cmd = 'SELECT' THEN '읽기'
--     WHEN cmd = 'INSERT' THEN '업로드'
--     WHEN cmd = 'UPDATE' THEN '수정'
--     WHEN cmd = 'DELETE' THEN '삭제'
--     ELSE cmd
--   END as operation_kr
-- FROM pg_policies 
-- WHERE schemaname = 'storage' 
--   AND tablename = 'objects'
--   AND policyname LIKE 'artist_photos_%';