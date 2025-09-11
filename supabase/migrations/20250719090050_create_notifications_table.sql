-- 멤버 알림 시스템 구현
-- 알림 테이블 생성 및 관련 함수/트리거 설정

-- 알림 유형 enum
CREATE TYPE notification_type AS ENUM (
  'post_new',          -- 새 게시글 알림
  'post_reply',        -- 게시글 댓글 알림
  'post_mention',      -- 게시글 멘션 알림
  'member_approved',   -- 회원 승인 알림
  'member_rejected',   -- 회원 거부 알림
  'artist_approved',   -- 아티스트 권한 승인 알림
  'artist_rejected',   -- 아티스트 권한 거부 알림
  'system_notice',     -- 시스템 공지 알림
  'maintenance',       -- 점검 알림
  'welcome'            -- 환영 메시지
);

-- 알림 테이블 생성
CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  -- 연관 데이터 (선택사항)
  related_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  related_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 인덱스 생성
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_read_status ON notifications(user_id, read_at);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_expires_at ON notifications(expires_at);

-- RLS 정책 설정
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 알림만 조회 가능
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- 사용자는 자신의 알림만 업데이트 가능 (읽음 상태 변경 등)
CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- 관리자는 모든 알림 조회 가능
CREATE POLICY "Admins can view all notifications" ON notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- 시스템에서 알림 생성 가능 (서비스 역할)
CREATE POLICY "Service role can insert notifications" ON notifications
  FOR INSERT WITH CHECK (true);

-- 알림 생성 함수
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type notification_type,
  p_title VARCHAR(200),
  p_message TEXT,
  p_data JSONB DEFAULT '{}',
  p_related_post_id UUID DEFAULT NULL,
  p_related_user_id UUID DEFAULT NULL,
  p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO notifications (
    user_id, type, title, message, data, related_post_id, related_user_id, expires_at
  ) VALUES (
    p_user_id, p_type, p_title, p_message, p_data, p_related_post_id, p_related_user_id, p_expires_at
  ) RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 대량 알림 생성 함수 (공지사항 등)
CREATE OR REPLACE FUNCTION create_bulk_notification(
  p_user_ids UUID[],
  p_type notification_type,
  p_title VARCHAR(200),
  p_message TEXT,
  p_data JSONB DEFAULT '{}',
  p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  WITH inserted AS (
    INSERT INTO notifications (user_id, type, title, message, data, expires_at)
    SELECT unnest(p_user_ids), p_type, p_title, p_message, p_data, p_expires_at
    RETURNING id
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;
  
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 알림 읽음 처리 함수
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE notifications 
  SET read_at = NOW() 
  WHERE id = p_notification_id 
    AND user_id = auth.uid() 
    AND read_at IS NULL;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 모든 알림 읽음 처리 함수
CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE notifications 
  SET read_at = NOW() 
  WHERE user_id = auth.uid() 
    AND read_at IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 만료된 알림 정리 함수
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM notifications 
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 트리거: 새 게시글 알림 자동 생성
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_new_post
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_post();

-- 트리거: 댓글 알림 자동 생성
CREATE OR REPLACE FUNCTION notify_new_comment()
RETURNS TRIGGER AS $$
DECLARE
  post_author_id UUID;
  post_title VARCHAR;
BEGIN
  -- 게시글 작성자 정보 조회
  SELECT author_id, title INTO post_author_id, post_title
  FROM posts WHERE id = NEW.post_id;
  
  -- 댓글 작성자와 게시글 작성자가 다른 경우에만 알림
  IF post_author_id != NEW.author_id THEN
    PERFORM create_notification(
      post_author_id,
      'post_reply',
      '댓글이 달렸습니다',
      post_title || '에 새로운 댓글이 달렸습니다.',
      jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id),
      NEW.post_id,
      NEW.author_id,
      NOW() + INTERVAL '30 days'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_new_comment
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_comment();

-- 트리거: 회원 상태 변경 알림
CREATE OR REPLACE FUNCTION notify_member_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- 승인된 경우
  IF OLD.registration_status = 'pending' AND NEW.registration_status = 'approved' THEN
    PERFORM create_notification(
      NEW.id,
      'member_approved',
      '회원 가입이 승인되었습니다',
      '경기아트콜렉티브 협동조합에 오신 것을 환영합니다! 이제 모든 기능을 이용하실 수 있습니다.',
      jsonb_build_object('approved_at', NOW()),
      NULL,
      NULL,
      NOW() + INTERVAL '90 days'
    );
  END IF;
  
  -- 거부된 경우
  IF OLD.registration_status = 'pending' AND NEW.registration_status = 'rejected' THEN
    PERFORM create_notification(
      NEW.id,
      'member_rejected',
      '회원 가입이 거부되었습니다',
      '죄송합니다. 회원 가입 신청이 거부되었습니다. 문의사항이 있으시면 관리자에게 연락해 주세요.',
      jsonb_build_object('rejected_at', NOW()),
      NULL,
      NULL,
      NOW() + INTERVAL '30 days'
    );
  END IF;
  
  -- 아티스트 권한 승인
  IF OLD.is_artist = false AND NEW.is_artist = true THEN
    PERFORM create_notification(
      NEW.id,
      'artist_approved',
      '아티스트 권한이 승인되었습니다',
      '축하합니다! 아티스트 권한이 승인되어 아티스트 프로필을 관리할 수 있습니다.',
      jsonb_build_object('artist_approved_at', NOW()),
      NULL,
      NULL,
      NOW() + INTERVAL '90 days'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_member_status_change
  AFTER UPDATE ON member_profiles
  FOR EACH ROW
  EXECUTE FUNCTION notify_member_status_change();

-- 정기적 정리 작업을 위한 cron job (supabase pg_cron 확장 필요)
-- SELECT cron.schedule('cleanup-expired-notifications', '0 2 * * *', 'SELECT cleanup_expired_notifications();');

-- 알림 통계 뷰
CREATE VIEW notification_stats AS
SELECT 
  user_id,
  COUNT(*) as total_notifications,
  COUNT(*) FILTER (WHERE read_at IS NULL) as unread_count,
  COUNT(*) FILTER (WHERE read_at IS NOT NULL) as read_count,
  MAX(created_at) as latest_notification_at
FROM notifications
GROUP BY user_id;

-- 권한 부여
GRANT SELECT ON notification_stats TO authenticated;

-- 코멘트 추가
COMMENT ON TABLE notifications IS '사용자 알림 테이블';
COMMENT ON COLUMN notifications.type IS '알림 유형 (새 게시글, 댓글, 시스템 공지 등)';
COMMENT ON COLUMN notifications.data IS '알림 관련 추가 데이터 (JSON 형태)';
COMMENT ON COLUMN notifications.read_at IS '알림 읽은 시간 (NULL이면 미읽음)';
COMMENT ON COLUMN notifications.expires_at IS '알림 만료 시간 (NULL이면 영구)';