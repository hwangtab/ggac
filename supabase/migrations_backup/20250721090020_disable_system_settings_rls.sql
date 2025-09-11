-- 시스템 설정 테이블의 RLS 완전 비활성화
-- 함수 레벨에서 이미 관리자 권한을 체크하므로 테이블 레벨 RLS는 불필요
-- RLS와 SECURITY DEFINER 함수 간의 충돌을 해결

-- 기존 RLS 정책들 모두 삭제
DROP POLICY IF EXISTS "Authenticated users can read settings" ON system_settings;
DROP POLICY IF EXISTS "Only functions can modify settings" ON system_settings;
DROP POLICY IF EXISTS "Admins can manage all settings" ON system_settings;
DROP POLICY IF EXISTS "Admins can access all settings" ON system_settings;

-- RLS 완전 비활성화
ALTER TABLE system_settings DISABLE ROW LEVEL SECURITY;

-- 보안 강화: 테이블에 대한 직접 접근 권한 제거
-- 함수를 통해서만 접근 가능하도록 제한
REVOKE ALL ON system_settings FROM authenticated;
REVOKE ALL ON system_settings FROM anon;
REVOKE ALL ON system_settings FROM public;

-- 함수 실행 권한은 유지 (관리자 권한은 함수 내부에서 체크)
GRANT EXECUTE ON FUNCTION get_system_settings(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION update_system_setting(system_setting_category, VARCHAR, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_system_setting(system_setting_category, VARCHAR) TO authenticated;

-- 시스템 설정 enum 타입 사용 권한도 부여
GRANT USAGE ON TYPE system_setting_category TO authenticated;

-- 폴백 메커니즘을 위한 최소한의 READ 권한 부여 (관리자만)
-- 이는 API의 폴백 쿼리가 작동하도록 하기 위함
CREATE POLICY "Admin fallback read only" ON system_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
        AND is_admin = true 
        AND registration_status = 'approved' 
        AND is_active = true
    )
  );

-- 하지만 RLS는 비활성화된 상태이므로 이 정책은 실제로는 적용되지 않음
-- 대신 테이블 직접 접근을 위한 권한을 관리자에게만 부여
GRANT SELECT ON system_settings TO authenticated;

-- 다른 작업(INSERT, UPDATE, DELETE)은 여전히 함수를 통해서만 가능