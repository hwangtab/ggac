-- 아티스트 프로필 사진 기능을 위한 데이터베이스 스키마 확장
-- artists 테이블에 프로필 사진 관련 필드 추가

-- 프로필 사진 관련 필드 추가
ALTER TABLE artists ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS profile_photo_metadata JSONB DEFAULT '{}';

-- profile_photo_metadata 컬럼에 대한 설명
COMMENT ON COLUMN artists.profile_photo_url IS '아티스트 프로필 사진 URL (Supabase Storage 경로)';
COMMENT ON COLUMN artists.profile_photo_metadata IS '아티스트 프로필 사진 메타데이터 (파일 크기, 형식, 업로드 시간 등)';

-- 프로필 사진 메타데이터 구조 예시:
-- {
--   "original_filename": "profile.jpg",
--   "file_size": 1048576,
--   "content_type": "image/jpeg",
--   "width": 500,
--   "height": 500,
--   "uploaded_at": "2025-01-20T10:00:00Z",
--   "processed": true,
--   "versions": {
--     "thumbnail": "artists/artist-id/thumbnail.webp",
--     "medium": "artists/artist-id/medium.webp",
--     "large": "artists/artist-id/large.webp"
--   },
--   "crop_info": {
--     "x": 0,
--     "y": 0,
--     "width": 500,
--     "height": 500
--   }
-- }

-- 프로필 사진 URL에 대한 인덱스 생성 (선택적 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_artists_photo_url ON artists(profile_photo_url) 
WHERE profile_photo_url IS NOT NULL;

-- 아티스트 프로필 사진 관련 유틸리티 함수 생성

-- 1. 아티스트의 프로필 사진 정보 조회 함수
CREATE OR REPLACE FUNCTION get_artist_photo_info(artist_legacy_id TEXT)
RETURNS TABLE (
  photo_url TEXT,
  metadata JSONB,
  has_photo BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.profile_photo_url,
    a.profile_photo_metadata,
    (a.profile_photo_url IS NOT NULL AND a.profile_photo_url != '') as has_photo
  FROM artists a
  WHERE a.legacy_id = artist_legacy_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 아티스트 프로필 사진 업데이트 함수
CREATE OR REPLACE FUNCTION update_artist_photo(
  artist_legacy_id TEXT,
  photo_url TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE artists 
  SET 
    profile_photo_url = photo_url,
    profile_photo_metadata = metadata,
    updated_at = NOW()
  WHERE legacy_id = artist_legacy_id;
  
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 아티스트 프로필 사진 삭제 함수
CREATE OR REPLACE FUNCTION delete_artist_photo(artist_legacy_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE artists 
  SET 
    profile_photo_url = NULL,
    profile_photo_metadata = '{}'::JSONB,
    updated_at = NOW()
  WHERE legacy_id = artist_legacy_id;
  
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 프로필 사진이 있는 아티스트 수 통계 함수
CREATE OR REPLACE FUNCTION get_artist_photo_stats()
RETURNS TABLE (
  total_artists BIGINT,
  artists_with_photo BIGINT,
  photo_percentage NUMERIC(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_artists,
    COUNT(profile_photo_url) as artists_with_photo,
    ROUND(
      (COUNT(profile_photo_url) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC, 
      2
    ) as photo_percentage
  FROM artists
  WHERE is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_artist_photo_info TO authenticated;
GRANT EXECUTE ON FUNCTION update_artist_photo TO authenticated;
GRANT EXECUTE ON FUNCTION delete_artist_photo TO authenticated;
GRANT EXECUTE ON FUNCTION get_artist_photo_stats TO authenticated;

-- 아티스트 프로필 사진이 포함된 뷰 생성
CREATE OR REPLACE VIEW artists_with_photo AS
SELECT 
  a.*,
  CASE 
    WHEN a.profile_photo_url IS NOT NULL AND a.profile_photo_url != '' 
    THEN TRUE 
    ELSE FALSE 
  END as has_profile_photo,
  
  -- 프로필 사진 메타데이터에서 유용한 정보 추출
  COALESCE(a.profile_photo_metadata->>'content_type', 'unknown') as photo_content_type,
  COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) as photo_file_size,
  COALESCE((a.profile_photo_metadata->>'width')::INTEGER, 0) as photo_width,
  COALESCE((a.profile_photo_metadata->>'height')::INTEGER, 0) as photo_height,
  
  -- 사진 크기를 읽기 쉬운 형태로 변환
  CASE 
    WHEN COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) < 1024 
      THEN COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) || ' B'
    WHEN COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) < 1024*1024 
      THEN ROUND(COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0)/1024.0, 1) || ' KB'
    ELSE ROUND(COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0)/(1024.0*1024), 1) || ' MB'
  END as photo_size_formatted

FROM artists a;

-- 뷰 권한 설정  
GRANT SELECT ON artists_with_photo TO authenticated;

-- 뷰에 대한 RLS 활성화 (기존 artists와 동일한 정책 적용)
ALTER VIEW artists_with_photo SET (security_barrier = true);

-- 코멘트 추가
COMMENT ON FUNCTION get_artist_photo_info IS '아티스트 프로필 사진 정보 조회';
COMMENT ON FUNCTION update_artist_photo IS '아티스트 프로필 사진 업데이트';
COMMENT ON FUNCTION delete_artist_photo IS '아티스트 프로필 사진 삭제';
COMMENT ON FUNCTION get_artist_photo_stats IS '아티스트 프로필 사진 통계 조회';
COMMENT ON VIEW artists_with_photo IS '프로필 사진 정보가 포함된 아티스트 뷰';

-- 기존 profile_image 필드가 있다면 데이터 마이그레이션 준비
-- (실제 마이그레이션은 데이터 확인 후 별도 실행)
-- UPDATE artists 
-- SET profile_photo_url = profile_image
-- WHERE profile_image IS NOT NULL AND profile_image != '' 
--   AND (profile_photo_url IS NULL OR profile_photo_url = '');