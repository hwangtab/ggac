-- 프로필 사진 전용 Supabase Storage bucket 및 정책 설정

-- 프로필 사진 전용 bucket 생성
CREATE OR REPLACE FUNCTION ensure_profiles_bucket_exists()
RETURNS BOOLEAN AS $$
DECLARE
  bucket_exists BOOLEAN;
BEGIN
  -- bucket 존재 여부 확인
  SELECT EXISTS(
    SELECT 1 FROM storage.buckets WHERE id = 'profiles'
  ) INTO bucket_exists;
  
  -- bucket이 없으면 생성 시도
  IF NOT bucket_exists THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'profiles', 
        'profiles', 
        true,  -- 공개 버킷 (프로필 사진은 공개)
        2097152, -- 2MB 제한
        ARRAY[
          'image/jpeg', 
          'image/png', 
          'image/webp',
          'image/gif'
        ]
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
SELECT ensure_profiles_bucket_exists();

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION ensure_profiles_bucket_exists TO service_role;

-- Storage RLS 정책 설정

-- 1. 프로필 사진 공개 읽기 정책 (모든 사용자가 읽기 가능)
-- 기존 정책이 있으면 삭제 후 재생성
DROP POLICY IF EXISTS "프로필 사진 공개 읽기" ON storage.objects;
CREATE POLICY "프로필 사진 공개 읽기" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'profiles');

-- 2. 프로필 사진 업로드 정책 (본인만 업로드 가능)
DROP POLICY IF EXISTS "프로필 사진 업로드" ON storage.objects;
CREATE POLICY "프로필 사진 업로드" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profiles' AND
    -- 파일 경로가 사용자 ID로 시작하는지 확인 (profiles/user-id/...)
    (storage.foldername(name))[1] = auth.uid()::text AND
    -- 승인된 활성 멤버만 업로드 가능
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND registration_status = 'approved' 
      AND is_active = true
    )
  );

-- 3. 프로필 사진 업데이트 정책 (본인만 수정 가능)
DROP POLICY IF EXISTS "프로필 사진 업데이트" ON storage.objects;
CREATE POLICY "프로필 사진 업데이트" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profiles' AND
    -- 파일 경로가 사용자 ID로 시작하는지 확인
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. 프로필 사진 삭제 정책 (본인 또는 관리자만 삭제 가능)
DROP POLICY IF EXISTS "프로필 사진 삭제" ON storage.objects;
CREATE POLICY "프로필 사진 삭제" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profiles' AND (
      -- 본인의 파일인지 확인
      (storage.foldername(name))[1] = auth.uid()::text OR
      -- 관리자인지 확인
      EXISTS (
        SELECT 1 FROM member_profiles 
        WHERE id = auth.uid() 
        AND is_admin = true
      )
    )
  );

-- 프로필 사진 관련 유틸리티 함수들

-- 1. 사용자의 프로필 사진 Storage 경로 생성 함수
CREATE OR REPLACE FUNCTION generate_profile_photo_path(
  user_id UUID,
  file_extension TEXT DEFAULT 'jpg'
)
RETURNS TEXT AS $$
BEGIN
  -- profiles/user-id/profile.ext 형태로 경로 생성
  RETURN 'profiles/' || user_id::text || '/profile.' || LOWER(file_extension);
END;
$$ LANGUAGE plpgsql;

-- 2. 프로필 사진 썸네일 경로 생성 함수
CREATE OR REPLACE FUNCTION generate_profile_thumbnail_path(
  user_id UUID,
  size TEXT DEFAULT 'medium'
)
RETURNS TEXT AS $$
BEGIN
  -- profiles/user-id/thumbnail_size.webp 형태로 경로 생성
  RETURN 'profiles/' || user_id::text || '/thumbnail_' || size || '.webp';
END;
$$ LANGUAGE plpgsql;

-- 3. Storage URL 생성 함수 (Supabase 공개 URL)
CREATE OR REPLACE FUNCTION get_profile_photo_public_url(storage_path TEXT)
RETURNS TEXT AS $$
DECLARE
  base_url TEXT;
BEGIN
  -- Supabase Storage 공개 URL 생성
  -- 실제 환경에서는 SUPABASE_URL 환경변수 사용
  base_url := current_setting('app.supabase_url', true);
  
  IF base_url IS NULL OR base_url = '' THEN
    -- 기본값 설정 (환경변수가 없는 경우)
    base_url := 'https://your-project.supabase.co';
  END IF;
  
  RETURN base_url || '/storage/v1/object/public/profiles/' || storage_path;
END;
$$ LANGUAGE plpgsql;

-- 4. 사용자의 모든 프로필 사진 파일 조회 함수
CREATE OR REPLACE FUNCTION get_user_profile_files(user_id UUID)
RETURNS TABLE (
  name TEXT,
  size BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  public_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    obj.name,
    obj.metadata->>'size'::BIGINT as size,
    obj.created_at,
    obj.updated_at,
    get_profile_photo_public_url(obj.name) as public_url
  FROM storage.objects obj
  WHERE 
    obj.bucket_id = 'profiles' AND
    (storage.foldername(obj.name))[1] = user_id::text
  ORDER BY obj.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 고아 파일 정리 함수 (DB에 참조되지 않는 Storage 파일)
CREATE OR REPLACE FUNCTION cleanup_orphaned_profile_photos()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  orphaned_file RECORD;
BEGIN
  -- 관리자만 실행 가능
  IF NOT EXISTS (
    SELECT 1 FROM member_profiles 
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  -- DB에 참조되지 않는 Storage 파일 찾기 및 삭제
  FOR orphaned_file IN
    SELECT obj.name
    FROM storage.objects obj
    WHERE 
      obj.bucket_id = 'profiles' AND
      NOT EXISTS (
        SELECT 1 FROM member_profiles mp
        WHERE mp.profile_photo_url LIKE '%' || obj.name || '%'
      )
  LOOP
    -- Storage에서 파일 삭제
    DELETE FROM storage.objects 
    WHERE bucket_id = 'profiles' AND name = orphaned_file.name;
    
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 프로필 사진 통계 함수
CREATE OR REPLACE FUNCTION get_profile_storage_stats()
RETURNS TABLE (
  total_files BIGINT,
  total_size BIGINT,
  total_size_formatted TEXT,
  avg_file_size BIGINT,
  largest_file_size BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_files,
    COALESCE(SUM((metadata->>'size')::BIGINT), 0) as total_size,
    CASE 
      WHEN COALESCE(SUM((metadata->>'size')::BIGINT), 0) < 1024 
        THEN COALESCE(SUM((metadata->>'size')::BIGINT), 0) || ' B'
      WHEN COALESCE(SUM((metadata->>'size')::BIGINT), 0) < 1024*1024 
        THEN ROUND(COALESCE(SUM((metadata->>'size')::BIGINT), 0)/1024.0, 1) || ' KB'
      WHEN COALESCE(SUM((metadata->>'size')::BIGINT), 0) < 1024*1024*1024 
        THEN ROUND(COALESCE(SUM((metadata->>'size')::BIGINT), 0)/(1024.0*1024), 1) || ' MB'
      ELSE ROUND(COALESCE(SUM((metadata->>'size')::BIGINT), 0)/(1024.0*1024*1024), 1) || ' GB'
    END as total_size_formatted,
    COALESCE(AVG((metadata->>'size')::BIGINT), 0) as avg_file_size,
    COALESCE(MAX((metadata->>'size')::BIGINT), 0) as largest_file_size
  FROM storage.objects
  WHERE bucket_id = 'profiles';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION generate_profile_photo_path TO authenticated;
GRANT EXECUTE ON FUNCTION generate_profile_thumbnail_path TO authenticated;
GRANT EXECUTE ON FUNCTION get_profile_photo_public_url TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_profile_files TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_profile_photos TO authenticated;
GRANT EXECUTE ON FUNCTION get_profile_storage_stats TO authenticated;

-- 프로필 사진 관련 뷰 생성 (Storage와 DB 정보 결합)
CREATE OR REPLACE VIEW profile_photos_with_storage AS
SELECT 
  mp.id as user_id,
  mp.display_name,
  mp.profile_photo_url,
  mp.profile_photo_metadata,
  mp.has_profile_photo,
  
  -- Storage 정보 (Storage objects와 조인)
  obj.name as storage_name,
  obj.created_at as uploaded_at,
  obj.updated_at as last_modified,
  (obj.metadata->>'size')::BIGINT as file_size,
  obj.metadata->>'mimetype' as mime_type,
  
  -- 공개 URL 생성
  CASE 
    WHEN mp.profile_photo_url IS NOT NULL 
    THEN get_profile_photo_public_url(obj.name)
    ELSE NULL
  END as public_url

FROM member_profiles_with_photo mp
LEFT JOIN storage.objects obj ON (
  obj.bucket_id = 'profiles' AND
  mp.profile_photo_url LIKE '%' || obj.name || '%'
)
WHERE mp.registration_status = 'approved' AND mp.is_active = true;

-- 뷰 권한 설정
GRANT SELECT ON profile_photos_with_storage TO authenticated;

-- 코멘트 추가
COMMENT ON FUNCTION ensure_profiles_bucket_exists IS 'profiles Storage bucket 존재 확인 및 생성';
COMMENT ON FUNCTION generate_profile_photo_path IS '프로필 사진 Storage 경로 생성';
COMMENT ON FUNCTION generate_profile_thumbnail_path IS '프로필 사진 썸네일 경로 생성';
COMMENT ON FUNCTION get_profile_photo_public_url IS 'Storage 경로를 공개 URL로 변환';
COMMENT ON FUNCTION get_user_profile_files IS '사용자의 모든 프로필 사진 파일 조회';
COMMENT ON FUNCTION cleanup_orphaned_profile_photos IS '고아 프로필 사진 파일 정리';
COMMENT ON FUNCTION get_profile_storage_stats IS '프로필 사진 Storage 통계';
COMMENT ON VIEW profile_photos_with_storage IS '프로필 사진과 Storage 정보를 결합한 뷰';