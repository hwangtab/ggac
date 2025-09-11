-- 아티스트 프로필 사진 전용 Supabase Storage bucket 및 정책 설정

-- 아티스트 프로필 사진 전용 bucket 생성
CREATE OR REPLACE FUNCTION ensure_artists_bucket_exists()
RETURNS BOOLEAN AS $$
DECLARE
  bucket_exists BOOLEAN;
BEGIN
  -- bucket 존재 여부 확인
  SELECT EXISTS(
    SELECT 1 FROM storage.buckets WHERE id = 'artists'
  ) INTO bucket_exists;
  
  -- bucket이 없으면 생성 시도
  IF NOT bucket_exists THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'artists', 
        'artists', 
        true,  -- 공개 버킷 (아티스트 프로필 사진은 공개)
        5242880, -- 5MB 제한 (아티스트 사진은 더 큰 사이즈 허용)
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
SELECT ensure_artists_bucket_exists();

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION ensure_artists_bucket_exists TO service_role;

-- Storage RLS 정책 설정

-- 1. 아티스트 프로필 사진 공개 읽기 정책 (모든 사용자가 읽기 가능)
DROP POLICY IF EXISTS "아티스트 프로필 사진 공개 읽기" ON storage.objects;
CREATE POLICY "아티스트 프로필 사진 공개 읽기" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'artists');

-- 2. 아티스트 프로필 사진 업로드 정책 (아티스트 권한이 있는 사용자만)
DROP POLICY IF EXISTS "아티스트 프로필 사진 업로드" ON storage.objects;
CREATE POLICY "아티스트 프로필 사진 업로드" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'artists' AND
    -- 파일 경로가 사용자의 artist_id로 시작하는지 확인 (artists/artist-id/...)
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND is_artist = true
      AND artist_id IS NOT NULL
      AND registration_status = 'approved' 
      AND is_active = true
      AND (storage.foldername(name))[1] = artist_id
    )
  );

-- 3. 아티스트 프로필 사진 업데이트 정책 (본인의 아티스트 프로필만)
DROP POLICY IF EXISTS "아티스트 프로필 사진 업데이트" ON storage.objects;
CREATE POLICY "아티스트 프로필 사진 업데이트" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'artists' AND
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND is_artist = true
      AND artist_id IS NOT NULL
      AND (storage.foldername(name))[1] = artist_id
    )
  );

-- 4. 아티스트 프로필 사진 삭제 정책 (본인 또는 관리자만)
DROP POLICY IF EXISTS "아티스트 프로필 사진 삭제" ON storage.objects;
CREATE POLICY "아티스트 프로필 사진 삭제" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'artists' AND (
      -- 본인의 아티스트 파일인지 확인
      EXISTS (
        SELECT 1 FROM member_profiles 
        WHERE id = auth.uid() 
        AND is_artist = true
        AND artist_id IS NOT NULL
        AND (storage.foldername(name))[1] = artist_id
      ) OR
      -- 관리자인지 확인
      EXISTS (
        SELECT 1 FROM member_profiles 
        WHERE id = auth.uid() 
        AND is_admin = true
      )
    )
  );

-- 아티스트 프로필 사진 관련 유틸리티 함수들

-- 1. 아티스트의 프로필 사진 Storage 경로 생성 함수
CREATE OR REPLACE FUNCTION generate_artist_photo_path(
  artist_id TEXT,
  file_extension TEXT DEFAULT 'jpg'
)
RETURNS TEXT AS $$
BEGIN
  -- artists/artist-id/profile_timestamp.ext 형태로 경로 생성
  RETURN 'artists/' || artist_id || '/profile_' || EXTRACT(EPOCH FROM NOW())::BIGINT || '.' || LOWER(file_extension);
END;
$$ LANGUAGE plpgsql;

-- 2. 아티스트 프로필 사진 썸네일 경로 생성 함수
CREATE OR REPLACE FUNCTION generate_artist_thumbnail_path(
  artist_id TEXT,
  size TEXT DEFAULT 'medium'
)
RETURNS TEXT AS $$
BEGIN
  -- artists/artist-id/thumbnail_size.webp 형태로 경로 생성
  RETURN 'artists/' || artist_id || '/thumbnail_' || size || '.webp';
END;
$$ LANGUAGE plpgsql;

-- 3. 아티스트 Storage URL 생성 함수 (Supabase 공개 URL)
CREATE OR REPLACE FUNCTION get_artist_photo_public_url(storage_path TEXT)
RETURNS TEXT AS $$
DECLARE
  base_url TEXT;
BEGIN
  -- Supabase Storage 공개 URL 생성
  base_url := current_setting('app.supabase_url', true);
  
  IF base_url IS NULL OR base_url = '' THEN
    -- 기본값 설정 (환경변수가 없는 경우)
    base_url := 'https://your-project.supabase.co';
  END IF;
  
  RETURN base_url || '/storage/v1/object/public/artists/' || storage_path;
END;
$$ LANGUAGE plpgsql;

-- 4. 아티스트의 모든 프로필 사진 파일 조회 함수
CREATE OR REPLACE FUNCTION get_artist_profile_files(artist_id TEXT)
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
    (obj.metadata->>'size')::BIGINT as size,
    obj.created_at,
    obj.updated_at,
    get_artist_photo_public_url(obj.name) as public_url
  FROM storage.objects obj
  WHERE 
    obj.bucket_id = 'artists' AND
    (storage.foldername(obj.name))[1] = artist_id
  ORDER BY obj.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 고아 아티스트 파일 정리 함수 (DB에 참조되지 않는 Storage 파일)
CREATE OR REPLACE FUNCTION cleanup_orphaned_artist_photos()
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
      obj.bucket_id = 'artists' AND
      NOT EXISTS (
        SELECT 1 FROM artists a
        WHERE a.profile_photo_url LIKE '%' || obj.name || '%'
      )
  LOOP
    -- Storage에서 파일 삭제
    DELETE FROM storage.objects 
    WHERE bucket_id = 'artists' AND name = orphaned_file.name;
    
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 아티스트 프로필 사진 통계 함수
CREATE OR REPLACE FUNCTION get_artist_storage_stats()
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
  WHERE bucket_id = 'artists';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION generate_artist_photo_path TO authenticated;
GRANT EXECUTE ON FUNCTION generate_artist_thumbnail_path TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_photo_public_url TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_profile_files TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_artist_photos TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_storage_stats TO authenticated;

-- 아티스트 프로필 사진 관련 뷰 생성 (Storage와 DB 정보 결합)
CREATE OR REPLACE VIEW artist_photos_with_storage AS
SELECT 
  a.id,
  a.legacy_id,
  a.name as artist_name,
  a.profile_photo_url,
  a.profile_photo_metadata,
  a.has_profile_photo,
  
  -- Storage 정보 (Storage objects와 조인)
  obj.name as storage_name,
  obj.created_at as uploaded_at,
  obj.updated_at as last_modified,
  (obj.metadata->>'size')::BIGINT as file_size,
  obj.metadata->>'mimetype' as mime_type,
  
  -- 공개 URL 생성
  CASE 
    WHEN a.profile_photo_url IS NOT NULL 
    THEN get_artist_photo_public_url(obj.name)
    ELSE NULL
  END as public_url

FROM artists_with_photo a
LEFT JOIN storage.objects obj ON (
  obj.bucket_id = 'artists' AND
  a.profile_photo_url LIKE '%' || obj.name || '%'
);

-- 뷰 권한 설정
GRANT SELECT ON artist_photos_with_storage TO authenticated;

-- 코멘트 추가
COMMENT ON FUNCTION ensure_artists_bucket_exists IS 'artists Storage bucket 존재 확인 및 생성';
COMMENT ON FUNCTION generate_artist_photo_path IS '아티스트 프로필 사진 Storage 경로 생성';
COMMENT ON FUNCTION generate_artist_thumbnail_path IS '아티스트 프로필 사진 썸네일 경로 생성';
COMMENT ON FUNCTION get_artist_photo_public_url IS 'Storage 경로를 공개 URL로 변환';
COMMENT ON FUNCTION get_artist_profile_files IS '아티스트의 모든 프로필 사진 파일 조회';
COMMENT ON FUNCTION cleanup_orphaned_artist_photos IS '고아 아티스트 프로필 사진 파일 정리';
COMMENT ON FUNCTION get_artist_storage_stats IS '아티스트 프로필 사진 Storage 통계';
COMMENT ON VIEW artist_photos_with_storage IS '아티스트 프로필 사진과 Storage 정보를 결합한 뷰';