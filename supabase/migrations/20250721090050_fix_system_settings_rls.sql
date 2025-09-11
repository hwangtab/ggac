-- 시스템 설정 함수 RLS 권한 문제 해결
-- SECURITY DEFINER를 추가하여 함수가 관리자 권한으로 실행되도록 수정

-- 기존 함수 삭제 후 재생성 (SECURITY DEFINER 추가)
DROP FUNCTION IF EXISTS get_system_settings(BOOLEAN);

CREATE OR REPLACE FUNCTION get_system_settings(include_sensitive BOOLEAN DEFAULT false)
RETURNS TABLE(
  category system_setting_category,
  setting_key VARCHAR(100),
  setting_value JSONB,
  description TEXT,
  is_sensitive BOOLEAN,
  updated_at TIMESTAMP WITH TIME ZONE
) 
SECURITY DEFINER  -- 이 함수는 함수 소유자 권한으로 실행됨
SET search_path = public, auth
AS $$
DECLARE
  is_admin BOOLEAN := false;
BEGIN
  -- 관리자 권한 확인 (현재 사용자가 관리자인지 확인)
  SELECT EXISTS (
    SELECT 1 FROM member_profiles 
    WHERE id = auth.uid() 
      AND is_admin = true 
      AND registration_status = 'approved' 
      AND is_active = true
  ) INTO is_admin;
  
  -- 관리자가 아니면 에러 반환
  IF NOT is_admin THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  
  RETURN QUERY
  SELECT 
    ss.category,
    ss.setting_key,
    CASE 
      WHEN ss.is_sensitive AND NOT include_sensitive THEN
        -- 민감한 정보 마스킹 (include_sensitive=false일 때)
        jsonb_build_object(
          'masked', true,
          'description', '민감한 정보입니다'
        )
      ELSE ss.setting_value
    END as setting_value,
    ss.description,
    ss.is_sensitive,
    ss.updated_at
  FROM system_settings ss
  ORDER BY ss.category, ss.setting_key;
END;
$$ LANGUAGE plpgsql;

-- 동일하게 update_system_setting 함수도 SECURITY DEFINER로 수정
DROP FUNCTION IF EXISTS update_system_setting(system_setting_category, VARCHAR, JSONB);

CREATE OR REPLACE FUNCTION update_system_setting(
  p_category system_setting_category,
  p_setting_key VARCHAR(100),
  p_setting_value JSONB
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
  
  IF NOT is_admin THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  
  -- UPSERT: 존재하면 업데이트, 없으면 삽입
  INSERT INTO system_settings (category, setting_key, setting_value, updated_by)
  VALUES (p_category, p_setting_key, p_setting_value, auth.uid())
  ON CONFLICT (category, setting_key) 
  DO UPDATE SET 
    setting_value = EXCLUDED.setting_value,
    updated_at = NOW(),
    updated_by = auth.uid();
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- reset_system_setting 함수도 SECURITY DEFINER로 수정
DROP FUNCTION IF EXISTS reset_system_setting(system_setting_category, VARCHAR);

CREATE OR REPLACE FUNCTION reset_system_setting(
  p_category system_setting_category,
  p_setting_key VARCHAR(100)
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
  
  IF NOT is_admin THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  
  -- 해당 설정을 삭제 (기본값으로 되돌림)
  DELETE FROM system_settings 
  WHERE category = p_category AND setting_key = p_setting_key;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 함수 실행 권한 부여 (인증된 사용자만 실행 가능)
GRANT EXECUTE ON FUNCTION get_system_settings(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION update_system_setting(system_setting_category, VARCHAR, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_system_setting(system_setting_category, VARCHAR) TO authenticated;

-- 테이블에 대한 RLS 정책을 좀 더 관대하게 수정 (함수가 SECURITY DEFINER로 실행되므로)
DROP POLICY IF EXISTS "Admins can manage all settings" ON system_settings;

-- 새로운 RLS 정책: 모든 인증된 사용자가 읽을 수 있지만, 수정은 함수를 통해서만
CREATE POLICY "Authenticated users can read settings" ON system_settings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Only functions can modify settings" ON system_settings
  FOR ALL USING (false); -- 직접적인 수정 차단, 함수를 통해서만 가능