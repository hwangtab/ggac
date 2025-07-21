-- 시스템 전역 설정 관리 테이블 생성
-- 관리자만 수정 가능한 사이트 전체 설정을 관리

-- 설정 카테고리 enum
CREATE TYPE system_setting_category AS ENUM (
  'site',           -- 사이트 일반 설정
  'email',          -- 이메일 SMTP 설정  
  'security',       -- 보안 정책 설정
  'features'        -- 기능 활성화 설정
);

-- 시스템 설정 테이블
CREATE TABLE system_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category system_setting_category NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB NOT NULL DEFAULT '{}',
  description TEXT,
  is_sensitive BOOLEAN DEFAULT false, -- 민감한 정보 여부 (비밀번호 등)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  
  -- 유니크 제약 조건 (카테고리별 키는 유일)
  UNIQUE(category, setting_key)
);

-- 인덱스 생성
CREATE INDEX idx_system_settings_category ON system_settings(category);
CREATE INDEX idx_system_settings_updated_by ON system_settings(updated_by);

-- 기본 시스템 설정값 삽입
INSERT INTO system_settings (category, setting_key, setting_value, description, is_sensitive) VALUES
-- 사이트 설정
('site', 'maintenance_mode', '{"enabled": false, "message": "시스템 점검 중입니다. 잠시 후 다시 이용해 주세요."}', '유지보수 모드 설정', false),
('site', 'registration_enabled', '{"enabled": true, "require_approval": true}', '회원 가입 허용 설정', false),
('site', 'site_title', '{"value": "경기아트콜렉티브"}', '사이트 제목', false),
('site', 'site_description', '{"value": "경계 없는 상상, 함께 만드는 울림"}', '사이트 설명', false),
('site', 'max_members', '{"value": 1000, "current_count": 0}', '최대 회원 수', false),
('site', 'contact_info', '{"email": "contact@ggac.kr", "phone": "0507-1384-3144", "address": "경기도 고양시 덕양구 성사동 719"}', '연락처 정보', false),

-- 이메일 설정
('email', 'smtp_config', '{"host": "", "port": 587, "secure": true, "user": "", "password": "", "from_email": "noreply@ggac.kr", "from_name": "경기아트콜렉티브"}', 'SMTP 서버 설정', true),
('email', 'email_templates', '{"welcome": {"subject": "경기아트콜렉티브에 오신 것을 환영합니다", "enabled": true}, "approval": {"subject": "회원 승인 완료", "enabled": true}, "rejection": {"subject": "회원 가입 검토 결과", "enabled": true}}', '이메일 템플릿 설정', false),
('email', 'notification_settings', '{"admin_notifications": true, "member_notifications": true, "system_notifications": true}', '알림 이메일 설정', false),

-- 보안 설정
('security', 'session_config', '{"timeout_minutes": 480, "max_concurrent_sessions": 5, "require_reauth_for_sensitive": true}', '세션 관리 설정', false),
('security', 'login_policy', '{"max_attempts": 5, "lockout_duration_minutes": 30, "require_strong_password": true}', '로그인 정책', false),
('security', 'password_policy', '{"min_length": 8, "require_uppercase": true, "require_lowercase": true, "require_numbers": true, "require_special": false, "history_count": 5}', '비밀번호 정책', false),
('security', 'email_verification', '{"required": true, "token_expiry_hours": 24, "resend_limit": 3}', '이메일 인증 설정', false),
('security', 'rate_limiting', '{"api_requests_per_minute": 60, "login_attempts_per_hour": 10, "registration_per_day": 50}', '요청 제한 설정', false),

-- 기능 설정
('features', 'board_features', '{"enabled": true, "categories": ["공지", "잡담", "홍보", "건의"], "allow_anonymous": false, "moderation_enabled": true}', '게시판 기능 설정', false),
('features', 'artist_features', '{"registration_enabled": true, "portfolio_upload": true, "public_profile": true, "collaboration_requests": true}', '아티스트 기능 설정', false),
('features', 'comment_features', '{"enabled": true, "nested_replies": true, "max_depth": 3, "moderation_enabled": true, "allow_editing": true}', '댓글 기능 설정', false),
('features', 'file_upload', '{"enabled": true, "max_size_mb": 10, "allowed_types": ["image/jpeg", "image/png", "image/webp", "application/pdf"], "virus_scan": false}', '파일 업로드 설정', false),
('features', 'social_features', '{"likes_enabled": true, "sharing_enabled": true, "follow_system": false, "activity_feed": true}', '소셜 기능 설정', false);

-- RLS 정책 설정
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 설정 조회 가능 (민감한 정보는 제외)
CREATE POLICY "All users can view non-sensitive settings" ON system_settings
  FOR SELECT USING (NOT is_sensitive OR is_sensitive IS NULL);

-- 관리자는 모든 설정 조회 가능
CREATE POLICY "Admins can view all settings" ON system_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
        AND is_admin = true 
        AND registration_status = 'approved' 
        AND is_active = true
    )
  );

-- 관리자만 설정 수정 가능
CREATE POLICY "Admins can manage all settings" ON system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
        AND is_admin = true 
        AND registration_status = 'approved' 
        AND is_active = true
    )
  );

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_system_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_system_settings_updated_at();

-- 시스템 설정 조회 함수 (민감한 정보 마스킹)
CREATE OR REPLACE FUNCTION get_system_settings(include_sensitive BOOLEAN DEFAULT false)
RETURNS TABLE(
  category system_setting_category,
  setting_key VARCHAR(100),
  setting_value JSONB,
  description TEXT,
  is_sensitive BOOLEAN,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  is_admin BOOLEAN := false;
BEGIN
  -- 관리자 권한 확인
  SELECT EXISTS (
    SELECT 1 FROM member_profiles 
    WHERE id = auth.uid() 
      AND is_admin = true 
      AND registration_status = 'approved' 
      AND is_active = true
  ) INTO is_admin;
  
  RETURN QUERY
  SELECT 
    ss.category,
    ss.setting_key,
    CASE 
      WHEN ss.is_sensitive AND NOT (include_sensitive AND is_admin) THEN
        -- 민감한 정보 마스킹
        jsonb_build_object(
          'masked', true,
          'description', '민감한 정보는 관리자만 조회할 수 있습니다'
        )
      ELSE ss.setting_value
    END as setting_value,
    ss.description,
    ss.is_sensitive,
    ss.updated_at
  FROM system_settings ss
  ORDER BY ss.category, ss.setting_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 시스템 설정 업데이트 함수
CREATE OR REPLACE FUNCTION update_system_setting(
  p_category system_setting_category,
  p_setting_key VARCHAR(100),
  p_setting_value JSONB
) RETURNS UUID AS $$
DECLARE
  setting_id UUID;
  is_admin BOOLEAN := false;
BEGIN
  -- 관리자 권한 확인
  SELECT EXISTS (
    SELECT 1 FROM member_profiles 
    WHERE id = auth.uid() 
      AND is_admin = true 
      AND registration_status = 'approved' 
      AND is_active = true
  ) INTO is_admin;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  
  -- 설정 업데이트
  UPDATE system_settings 
  SET 
    setting_value = p_setting_value,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE category = p_category AND setting_key = p_setting_key
  RETURNING id INTO setting_id;
  
  IF setting_id IS NULL THEN
    RAISE EXCEPTION '존재하지 않는 설정입니다: %.%', p_category, p_setting_key;
  END IF;
  
  RETURN setting_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 시스템 설정 초기화 함수 (기본값으로 복원)
CREATE OR REPLACE FUNCTION reset_system_setting(
  p_category system_setting_category DEFAULT NULL,
  p_setting_key VARCHAR(100) DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  reset_count INTEGER := 0;
  is_admin BOOLEAN := false;
BEGIN
  -- 관리자 권한 확인
  SELECT EXISTS (
    SELECT 1 FROM member_profiles 
    WHERE id = auth.uid() 
      AND is_admin = true 
      AND registration_status = 'approved' 
      AND is_active = true
  ) INTO is_admin;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  
  -- 이 함수는 현재 단순히 특정 설정의 업데이트 기록을 리셋하는 역할
  -- 실제로는 기본값을 다시 삽입하는 로직이 필요할 수 있습니다
  
  -- 특정 설정 초기화
  IF p_category IS NOT NULL AND p_setting_key IS NOT NULL THEN
    UPDATE system_settings 
    SET updated_at = created_at, updated_by = NULL
    WHERE category = p_category AND setting_key = p_setting_key;
    GET DIAGNOSTICS reset_count = ROW_COUNT;
  -- 특정 카테고리 초기화
  ELSIF p_category IS NOT NULL THEN
    UPDATE system_settings 
    SET updated_at = created_at, updated_by = NULL
    WHERE category = p_category;
    GET DIAGNOSTICS reset_count = ROW_COUNT;
  END IF;
  
  RETURN reset_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 시스템 설정 변경 히스토리 테이블
CREATE TABLE system_settings_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_id UUID REFERENCES system_settings(id) ON DELETE CASCADE,
  category system_setting_category NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  change_reason TEXT
);

-- 히스토리 인덱스
CREATE INDEX idx_system_settings_history_setting_id ON system_settings_history(setting_id);
CREATE INDEX idx_system_settings_history_changed_by ON system_settings_history(changed_by);
CREATE INDEX idx_system_settings_history_changed_at ON system_settings_history(changed_at);

-- 설정 변경 히스토리 트리거
CREATE OR REPLACE FUNCTION log_system_settings_change()
RETURNS TRIGGER AS $$
BEGIN
  -- UPDATE 시에만 히스토리 기록
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO system_settings_history (
      setting_id, category, setting_key, 
      old_value, new_value, changed_by
    ) VALUES (
      NEW.id, NEW.category, NEW.setting_key,
      OLD.setting_value, NEW.setting_value, auth.uid()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_system_settings_change
  AFTER UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION log_system_settings_change();

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION get_system_settings TO authenticated;
GRANT EXECUTE ON FUNCTION update_system_setting TO authenticated;
GRANT EXECUTE ON FUNCTION reset_system_setting TO authenticated;

-- 테이블 권한 설정 (RLS 정책으로 제어됨)
GRANT SELECT ON system_settings TO authenticated;
GRANT SELECT ON system_settings_history TO authenticated;

-- 관리자만 테이블 수정 가능 (RLS 정책으로 제어됨)
GRANT INSERT, UPDATE, DELETE ON system_settings TO authenticated;

-- 코멘트 추가
COMMENT ON TABLE system_settings IS '시스템 전역 설정 테이블 (관리자만 수정 가능)';
COMMENT ON TABLE system_settings_history IS '시스템 설정 변경 히스토리 테이블';
COMMENT ON FUNCTION get_system_settings IS '시스템 설정 조회 (민감한 정보 마스킹)';
COMMENT ON FUNCTION update_system_setting IS '시스템 설정 업데이트 (관리자 전용)';
COMMENT ON FUNCTION reset_system_setting IS '시스템 설정 초기화 (관리자 전용)';