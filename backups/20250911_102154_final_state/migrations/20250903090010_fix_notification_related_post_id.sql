-- Migration: Fix notification system for announcement click functionality
-- Date: 2025-09-03
-- Purpose: Ensure announcement notifications have proper related_post_id for click functionality

-- 1. Update existing announcement notifications to have proper related_post_id
UPDATE notifications 
SET related_post_id = CAST(data->>'post_id' AS UUID)
WHERE type = 'post_new' 
  AND title = '새 공지사항이 등록되었습니다'
  AND related_post_id IS NULL
  AND data ? 'post_id'
  AND CAST(data->>'post_id' AS UUID) IS NOT NULL;

-- 2. Update the notify_new_post function to use create_notification instead of create_bulk_notification
-- This ensures all announcement notifications will have related_post_id set properly
CREATE OR REPLACE FUNCTION notify_new_post()
RETURNS TRIGGER AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- 공지사항인 경우 모든 승인된 멤버에게 알림
  IF NEW.category = '공지' THEN
    -- 각 사용자별로 개별 알림 생성 (related_post_id 포함)
    FOR user_record IN 
      SELECT id FROM member_profiles WHERE registration_status = 'approved'
    LOOP
      PERFORM create_notification(
        user_record.id,
        'post_new',
        '새 공지사항이 등록되었습니다',
        NEW.title,
        jsonb_build_object('post_id', NEW.id, 'category', NEW.category),
        NEW.id,  -- related_post_id 설정
        NEW.author_id,  -- related_user_id 설정  
        NOW() + INTERVAL '7 days'
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Add comment for documentation
COMMENT ON FUNCTION notify_new_post() IS '새 게시글 알림 생성 - 공지사항의 경우 related_post_id를 포함하여 클릭 가능한 알림 생성';