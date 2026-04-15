-- Fix: log_profile_photo_change 트리거 함수의 잘못된 컬럼명 수정
-- user_activities 테이블의 실제 컬럼명은 `metadata`이나 트리거에서 `action_details`로 잘못 참조함
-- 이로 인해 프로필 사진 변경 시 트리거가 항상 에러 발생

CREATE OR REPLACE FUNCTION log_profile_photo_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 프로필 사진이 추가된 경우
  IF OLD.profile_photo_url IS NULL AND NEW.profile_photo_url IS NOT NULL THEN
    INSERT INTO user_activities (user_id, action_type, metadata)
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
    INSERT INTO user_activities (user_id, action_type, metadata)
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
    INSERT INTO user_activities (user_id, action_type, metadata)
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
