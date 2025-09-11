-- 아티스트 프로필 사진 전용 Storage Bucket 생성
-- 이 스크립트는 artists bucket이 없는 경우에만 실행됩니다

-- artists bucket 생성 함수
CREATE OR REPLACE FUNCTION create_artists_bucket()
RETURNS BOOLEAN AS $$
DECLARE
  bucket_exists BOOLEAN;
  creation_success BOOLEAN := FALSE;
BEGIN
  -- bucket 존재 여부 확인
  SELECT EXISTS(
    SELECT 1 FROM storage.buckets WHERE id = 'artists'
  ) INTO bucket_exists;
  
  -- bucket이 없으면 생성 시도
  IF NOT bucket_exists THEN
    BEGIN
      -- artists bucket 생성
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'artists', 
        'artists', 
        true,
        5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      );
      
      creation_success := TRUE;
      RAISE NOTICE 'artists bucket이 성공적으로 생성되었습니다.';
      
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'artists bucket 생성 실패: %', SQLERRM;
      RAISE NOTICE 'Supabase Dashboard에서 수동으로 생성해주세요.';
      creation_success := FALSE;
    END;
  ELSE
    RAISE NOTICE 'artists bucket이 이미 존재합니다.';
    creation_success := TRUE;
  END IF;
  
  RETURN creation_success;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- bucket 생성 시도
SELECT create_artists_bucket();

-- 함수 정리 (일회성 사용)
DROP FUNCTION IF EXISTS create_artists_bucket();

-- bucket 생성 확인
DO $$
DECLARE
  bucket_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bucket_count 
  FROM storage.buckets 
  WHERE id = 'artists';
  
  IF bucket_count > 0 THEN
    RAISE NOTICE '✅ artists bucket이 존재합니다.';
  ELSE
    RAISE NOTICE '❌ artists bucket이 없습니다. Dashboard에서 수동 생성이 필요합니다.';
    RAISE NOTICE '📋 설정값:';
    RAISE NOTICE '   - Name: artists';
    RAISE NOTICE '   - Public: true';
    RAISE NOTICE '   - File size limit: 5242880 (5MB)';
    RAISE NOTICE '   - Allowed MIME types: image/jpeg,image/png,image/webp,image/gif';
  END IF;
END;
$$;