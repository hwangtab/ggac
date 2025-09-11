-- 사용자 설정 시스템 구현
-- 개인 설정, 알림 설정, 인터페이스 설정 등을 관리

-- 설정 유형 enum
CREATE TYPE setting_category AS ENUM (
  'notification',    -- 알림 설정
  'privacy',        -- 개인정보 설정
  'interface',      -- 인터페이스 설정
  'security',       -- 보안 설정
  'preference'      -- 개인 취향 설정
);

-- 사용자 설정 테이블
CREATE TABLE user_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category setting_category NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 유니크 제약 조건 (사용자별 카테고리별 키는 유일)
  UNIQUE(user_id, category, setting_key)
);

-- 인덱스 생성
CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX idx_user_settings_category ON user_settings(category);
CREATE INDEX idx_user_settings_user_category ON user_settings(user_id, category);

-- 기본 설정값 템플릿 테이블
CREATE TABLE default_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category setting_category NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  default_value JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  is_required BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(category, setting_key)
);

-- 기본 설정값 삽입
INSERT INTO default_settings (category, setting_key, default_value, description, is_required) VALUES
-- 알림 설정
('notification', 'email_notifications', '{"enabled": true, "post_notifications": true, "comment_notifications": true, "system_notifications": true}', '이메일 알림 설정', true),
('notification', 'web_notifications', '{"enabled": true, "post_notifications": true, "comment_notifications": true, "mention_notifications": true}', '웹 푸시 알림 설정', true),
('notification', 'notification_frequency', '{"value": "immediate", "options": ["immediate", "daily", "weekly", "never"]}', '알림 빈도 설정', true),

-- 개인정보 설정
('privacy', 'profile_visibility', '{"level": "members", "options": ["public", "members", "private"]}', '프로필 공개 범위', true),
('privacy', 'activity_visibility', '{"show_activity": true, "show_last_seen": false}', '활동 내역 공개 설정', false),
('privacy', 'contact_visibility', '{"show_email": false, "show_phone": false}', '연락처 공개 설정', false),

-- 인터페이스 설정
('interface', 'theme', '{"mode": "light", "options": ["light", "dark", "auto"]}', '테마 설정', true),
('interface', 'language', '{"locale": "ko", "options": ["ko", "en"]}', '언어 설정', true),
('interface', 'timezone', '{"value": "Asia/Seoul"}', '시간대 설정', true),
('interface', 'post_display', '{"items_per_page": 20, "view_mode": "card", "show_images": true}', '게시글 표시 설정', false),

-- 보안 설정
('security', 'session_timeout', '{"minutes": 480, "options": [60, 240, 480, 1440]}', '세션 타임아웃 설정', false),
('security', 'login_notifications', '{"notify_new_device": true, "notify_suspicious": true}', '로그인 알림 설정', false),
('security', 'two_factor', '{"enabled": false, "method": "none", "options": ["none", "email", "sms"]}', '2단계 인증 설정', false),

-- 개인 취향 설정
('preference', 'content_filter', '{"adult_content": false, "violence_content": false}', '콘텐츠 필터링 설정', false),
('preference', 'accessibility', '{"high_contrast": false, "large_text": false, "reduced_motion": false}', '접근성 설정', false),
('preference', 'auto_save', '{"enabled": true, "interval_minutes": 5}', '자동 저장 설정', false);

-- RLS 정책 설정
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE default_settings ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 설정만 조회/수정 가능
CREATE POLICY "Users can manage own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);

-- 모든 사용자가 기본 설정값 조회 가능
CREATE POLICY "Users can view default settings" ON default_settings
  FOR SELECT USING (true);

-- 관리자만 기본 설정값 수정 가능
CREATE POLICY "Admins can manage default settings" ON default_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();

-- 사용자 설정 조회 함수 (기본값 포함)
CREATE OR REPLACE FUNCTION get_user_settings(p_user_id UUID DEFAULT NULL)
RETURNS TABLE(
  category setting_category,
  setting_key VARCHAR(100),
  setting_value JSONB,
  is_default BOOLEAN,
  description TEXT
) AS $$
DECLARE
  target_user_id UUID;
BEGIN
  -- 파라미터가 없으면 현재 사용자
  target_user_id := COALESCE(p_user_id, auth.uid());
  
  RETURN QUERY
  SELECT 
    COALESCE(us.category, ds.category) as category,
    COALESCE(us.setting_key, ds.setting_key) as setting_key,
    COALESCE(us.setting_value, ds.default_value) as setting_value,
    (us.id IS NULL) as is_default,
    ds.description
  FROM default_settings ds
  LEFT JOIN user_settings us ON (
    us.user_id = target_user_id 
    AND us.category = ds.category 
    AND us.setting_key = ds.setting_key
  )
  ORDER BY ds.category, ds.setting_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 설정 업데이트 함수
CREATE OR REPLACE FUNCTION upsert_user_setting(
  p_category setting_category,
  p_setting_key VARCHAR(100),
  p_setting_value JSONB
) RETURNS UUID AS $$
DECLARE
  setting_id UUID;
  user_id UUID;
BEGIN
  user_id := auth.uid();
  
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- 설정이 존재하는지 확인
  IF NOT EXISTS (
    SELECT 1 FROM default_settings 
    WHERE category = p_category AND setting_key = p_setting_key
  ) THEN
    RAISE EXCEPTION 'Invalid setting: %.%', p_category, p_setting_key;
  END IF;
  
  -- UPSERT 실행
  INSERT INTO user_settings (user_id, category, setting_key, setting_value)
  VALUES (user_id, p_category, p_setting_key, p_setting_value)
  ON CONFLICT (user_id, category, setting_key)
  DO UPDATE SET 
    setting_value = EXCLUDED.setting_value,
    updated_at = NOW()
  RETURNING id INTO setting_id;
  
  RETURN setting_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 설정 초기화 함수 (기본값으로 복원)
CREATE OR REPLACE FUNCTION reset_user_settings(
  p_category setting_category DEFAULT NULL,
  p_setting_key VARCHAR(100) DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
  user_id UUID;
BEGIN
  user_id := auth.uid();
  
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- 특정 설정 삭제 (기본값으로 복원)
  IF p_category IS NOT NULL AND p_setting_key IS NOT NULL THEN
    DELETE FROM user_settings 
    WHERE user_id = user_id 
      AND category = p_category 
      AND setting_key = p_setting_key;
  -- 특정 카테고리 삭제
  ELSIF p_category IS NOT NULL THEN
    DELETE FROM user_settings 
    WHERE user_id = user_id AND category = p_category;
  -- 모든 설정 삭제
  ELSE
    DELETE FROM user_settings WHERE user_id = user_id;
  END IF;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 사용자별 설정 통계 뷰
CREATE VIEW user_settings_summary AS
SELECT 
  us.user_id,
  COUNT(*) as total_custom_settings,
  COUNT(*) FILTER (WHERE us.category = 'notification') as notification_settings,
  COUNT(*) FILTER (WHERE us.category = 'privacy') as privacy_settings,
  COUNT(*) FILTER (WHERE us.category = 'interface') as interface_settings,
  COUNT(*) FILTER (WHERE us.category = 'security') as security_settings,
  COUNT(*) FILTER (WHERE us.category = 'preference') as preference_settings,
  MAX(us.updated_at) as last_updated
FROM user_settings us
GROUP BY us.user_id;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_user_settings TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_user_setting TO authenticated;
GRANT EXECUTE ON FUNCTION reset_user_settings TO authenticated;

-- 뷰 권한 설정
GRANT SELECT ON user_settings_summary TO authenticated;

-- 테이블 권한 설정
GRANT SELECT, INSERT, UPDATE, DELETE ON user_settings TO authenticated;
GRANT SELECT ON default_settings TO authenticated;

-- 코멘트 추가
COMMENT ON TABLE user_settings IS '사용자별 개인 설정 테이블';
COMMENT ON TABLE default_settings IS '기본 설정값 템플릿 테이블';
COMMENT ON FUNCTION get_user_settings IS '사용자 설정 조회 (기본값 포함)';
COMMENT ON FUNCTION upsert_user_setting IS '사용자 설정 생성/업데이트';
COMMENT ON FUNCTION reset_user_settings IS '사용자 설정 초기화 (기본값으로 복원)';
COMMENT ON VIEW user_settings_summary IS '사용자별 설정 통계';