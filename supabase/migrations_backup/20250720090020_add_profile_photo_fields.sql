-- 프로필 사진 기능을 위한 데이터베이스 스키마 확장
-- member_profiles 테이블에 프로필 사진 관련 필드 추가

-- 프로필 사진 관련 필드 추가
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS profile_photo_metadata JSONB DEFAULT '{}';

-- profile_photo_metadata 컬럼에 대한 설명
COMMENT ON COLUMN member_profiles.profile_photo_url IS '프로필 사진 URL (Supabase Storage 경로)';
COMMENT ON COLUMN member_profiles.profile_photo_metadata IS '프로필 사진 메타데이터 (파일 크기, 형식, 업로드 시간 등)';

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
--     "thumbnail": "profiles/user-id/thumbnail.webp",
--     "medium": "profiles/user-id/medium.webp"
--   }
-- }

-- 프로필 사진 URL에 대한 인덱스 생성 (선택적 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_member_profiles_photo_url ON member_profiles(profile_photo_url) 
WHERE profile_photo_url IS NOT NULL;

-- 프로필 사진 관련 유틸리티 함수 생성

-- 1. 사용자의 프로필 사진 정보 조회 함수
CREATE OR REPLACE FUNCTION get_profile_photo_info(user_id UUID)
RETURNS TABLE (
  photo_url TEXT,
  metadata JSONB,
  has_photo BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mp.profile_photo_url,
    mp.profile_photo_metadata,
    (mp.profile_photo_url IS NOT NULL AND mp.profile_photo_url != '') as has_photo
  FROM member_profiles mp
  WHERE mp.id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 프로필 사진 업데이트 함수
CREATE OR REPLACE FUNCTION update_profile_photo(
  user_id UUID,
  photo_url TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE member_profiles 
  SET 
    profile_photo_url = photo_url,
    profile_photo_metadata = metadata,
    updated_at = NOW()
  WHERE id = user_id;
  
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 프로필 사진 삭제 함수
CREATE OR REPLACE FUNCTION delete_profile_photo(user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE member_profiles 
  SET 
    profile_photo_url = NULL,
    profile_photo_metadata = '{}'::JSONB,
    updated_at = NOW()
  WHERE id = user_id;
  
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 프로필 사진이 있는 활성 멤버 수 통계 함수
CREATE OR REPLACE FUNCTION get_profile_photo_stats()
RETURNS TABLE (
  total_members BIGINT,
  members_with_photo BIGINT,
  photo_percentage NUMERIC(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_members,
    COUNT(profile_photo_url) as members_with_photo,
    ROUND(
      (COUNT(profile_photo_url) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC, 
      2
    ) as photo_percentage
  FROM member_profiles
  WHERE registration_status = 'approved' AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_profile_photo_info TO authenticated;
GRANT EXECUTE ON FUNCTION update_profile_photo TO authenticated;
GRANT EXECUTE ON FUNCTION delete_profile_photo TO authenticated;
GRANT EXECUTE ON FUNCTION get_profile_photo_stats TO authenticated;

-- RLS 정책 업데이트는 필요시 별도로 수행
-- (기존 member_profiles RLS 정책이 새 컬럼도 커버함)

-- 트리거 함수: 프로필 사진 변경 시 활동 로그 생성
CREATE OR REPLACE FUNCTION log_profile_photo_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 프로필 사진이 추가된 경우
  IF OLD.profile_photo_url IS NULL AND NEW.profile_photo_url IS NOT NULL THEN
    INSERT INTO user_activities (user_id, action_type, action_details)
    VALUES (NEW.id, 'profile_update', 
      jsonb_build_object(
        'type', 'photo_added',
        'photo_url', NEW.profile_photo_url,
        'metadata', NEW.profile_photo_metadata
      )
    );
  -- 프로필 사진이 변경된 경우
  ELSIF OLD.profile_photo_url IS NOT NULL AND NEW.profile_photo_url IS NOT NULL 
        AND OLD.profile_photo_url != NEW.profile_photo_url THEN
    INSERT INTO user_activities (user_id, action_type, action_details)
    VALUES (NEW.id, 'profile_update', 
      jsonb_build_object(
        'type', 'photo_changed',
        'old_photo_url', OLD.profile_photo_url,
        'new_photo_url', NEW.profile_photo_url,
        'metadata', NEW.profile_photo_metadata
      )
    );
  -- 프로필 사진이 삭제된 경우
  ELSIF OLD.profile_photo_url IS NOT NULL AND NEW.profile_photo_url IS NULL THEN
    INSERT INTO user_activities (user_id, action_type, action_details)
    VALUES (NEW.id, 'profile_update', 
      jsonb_build_object(
        'type', 'photo_removed',
        'old_photo_url', OLD.profile_photo_url
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_log_profile_photo_change ON member_profiles;
CREATE TRIGGER trigger_log_profile_photo_change
  AFTER UPDATE ON member_profiles
  FOR EACH ROW
  WHEN (OLD.profile_photo_url IS DISTINCT FROM NEW.profile_photo_url)
  EXECUTE FUNCTION log_profile_photo_change();

-- 프로필 사진이 포함된 멤버 프로필 뷰 생성
CREATE OR REPLACE VIEW member_profiles_with_photo AS
SELECT 
  mp.*,
  CASE 
    WHEN mp.profile_photo_url IS NOT NULL AND mp.profile_photo_url != '' 
    THEN TRUE 
    ELSE FALSE 
  END as has_profile_photo,
  
  -- 프로필 사진 메타데이터에서 유용한 정보 추출
  COALESCE(mp.profile_photo_metadata->>'content_type', 'unknown') as photo_content_type,
  COALESCE((mp.profile_photo_metadata->>'file_size')::BIGINT, 0) as photo_file_size,
  COALESCE((mp.profile_photo_metadata->>'width')::INTEGER, 0) as photo_width,
  COALESCE((mp.profile_photo_metadata->>'height')::INTEGER, 0) as photo_height,
  
  -- 사진 크기를 읽기 쉬운 형태로 변환
  CASE 
    WHEN COALESCE((mp.profile_photo_metadata->>'file_size')::BIGINT, 0) < 1024 
      THEN COALESCE((mp.profile_photo_metadata->>'file_size')::BIGINT, 0) || ' B'
    WHEN COALESCE((mp.profile_photo_metadata->>'file_size')::BIGINT, 0) < 1024*1024 
      THEN ROUND(COALESCE((mp.profile_photo_metadata->>'file_size')::BIGINT, 0)/1024.0, 1) || ' KB'
    ELSE ROUND(COALESCE((mp.profile_photo_metadata->>'file_size')::BIGINT, 0)/(1024.0*1024), 1) || ' MB'
  END as photo_size_formatted

FROM member_profiles mp;

-- 뷰 권한 설정
GRANT SELECT ON member_profiles_with_photo TO authenticated;

-- 뷰에 대한 RLS 활성화 (기존 member_profiles와 동일한 정책 적용)
ALTER VIEW member_profiles_with_photo SET (security_barrier = true);

-- 코멘트 추가
COMMENT ON FUNCTION get_profile_photo_info IS '사용자 프로필 사진 정보 조회';
COMMENT ON FUNCTION update_profile_photo IS '프로필 사진 업데이트';
COMMENT ON FUNCTION delete_profile_photo IS '프로필 사진 삭제';
COMMENT ON FUNCTION get_profile_photo_stats IS '프로필 사진 통계 조회';
COMMENT ON VIEW member_profiles_with_photo IS '프로필 사진 정보가 포함된 멤버 프로필 뷰';
COMMENT ON TRIGGER trigger_log_profile_photo_change ON member_profiles IS '프로필 사진 변경 시 활동 로그 생성';