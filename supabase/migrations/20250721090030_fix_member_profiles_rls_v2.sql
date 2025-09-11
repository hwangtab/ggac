-- 회원 관리 RLS 순환 참조 문제 완전 해결 (수정버전)
-- 함수 오버로딩 문제 해결

-- ========================================
-- 1. 기존 RLS 정책 모두 삭제 (순환 참조 문제 해결)
-- ========================================

-- member_profiles 테이블의 모든 기존 정책 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON member_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON member_profiles;
DROP POLICY IF EXISTS "Service role can access all profiles" ON member_profiles;
DROP POLICY IF EXISTS "Authenticated users can view approved profiles" ON member_profiles;
DROP POLICY IF EXISTS "Enable read access for own profile" ON member_profiles;
DROP POLICY IF EXISTS "Enable update for own profile" ON member_profiles;
DROP POLICY IF EXISTS "Admin full access" ON member_profiles;
DROP POLICY IF EXISTS "Admin can view all" ON member_profiles;
DROP POLICY IF EXISTS "Admin can update all" ON member_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON member_profiles;

-- ========================================
-- 2. 누락된 컬럼 추가 (API 500 에러 해결)
-- ========================================

-- 회원 승인 관련 컬럼 추가
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id);
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- 회원 정지 관련 컬럼 추가
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS suspension_until DATE;

-- 기타 관리 필드 추가
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS profile_completeness_score INTEGER DEFAULT 0;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS membership_type TEXT DEFAULT 'regular';
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0;

-- 인덱스 추가 (성능 향상)
CREATE INDEX IF NOT EXISTS idx_member_profiles_approved_by ON member_profiles(approved_by);
CREATE INDEX IF NOT EXISTS idx_member_profiles_last_login ON member_profiles(last_login_at);
CREATE INDEX IF NOT EXISTS idx_member_profiles_verification ON member_profiles(verification_status);

-- ========================================
-- 3. 기존 함수 삭제 후 단일 함수 생성 (오버로딩 문제 해결)
-- ========================================

-- 기존 함수들 모두 삭제
DROP FUNCTION IF EXISTS public.is_admin_user();
DROP FUNCTION IF EXISTS public.is_admin_user(UUID);

-- 단일 관리자 확인 함수 생성 (SECURITY DEFINER로 RLS 우회)
CREATE OR REPLACE FUNCTION public.check_admin_user()
RETURNS boolean
SECURITY DEFINER  -- 이 함수는 함수 소유자 권한으로 실행됨 (RLS 우회)
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  -- NULL 체크
  IF current_user_id IS NULL THEN
    RETURN false;
  END IF;
  
  -- RLS를 우회하여 직접 쿼리 (순환 참조 없음)
  RETURN EXISTS (
    SELECT 1 FROM public.member_profiles 
    WHERE id = current_user_id
    AND is_admin = true 
    AND is_active = true 
    AND registration_status = 'approved'
  );
END;
$$ LANGUAGE plpgsql;

-- 함수 실행 권한 부여
GRANT EXECUTE ON FUNCTION public.check_admin_user() TO authenticated;

-- ========================================
-- 4. 새로운 RLS 정책 생성 (순환 참조 없음)
-- ========================================

-- 자신의 프로필은 항상 조회 가능
CREATE POLICY "Users can view own profile" ON member_profiles
  FOR SELECT USING (auth.uid() = id);

-- 자신의 프로필은 수정 가능 (기본 정보만)
CREATE POLICY "Users can update own profile" ON member_profiles
  FOR UPDATE USING (
    auth.uid() = id 
    AND auth.uid() IS NOT NULL
  );

-- 관리자는 모든 프로필 조회 가능 (순환 참조 없는 함수 사용)
CREATE POLICY "Admins can view all profiles" ON member_profiles
  FOR SELECT USING (public.check_admin_user());

-- 관리자는 모든 프로필 업데이트 가능
CREATE POLICY "Admins can update all profiles" ON member_profiles
  FOR UPDATE USING (public.check_admin_user());

-- 관리자는 프로필 삭제 가능
CREATE POLICY "Admins can delete profiles" ON member_profiles
  FOR DELETE USING (public.check_admin_user());

-- 서비스 역할은 모든 접근 권한 (시스템 작업용)
CREATE POLICY "Service role has full access" ON member_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- ========================================
-- 5. 관련 테이블 RLS도 정리 (필요시)
-- ========================================

-- posts 테이블이 있다면 관리자 권한 추가
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'posts') THEN
    -- 기존 관리자 정책 삭제 후 재생성
    DROP POLICY IF EXISTS "Admins can manage all posts" ON posts;
    CREATE POLICY "Admins can manage all posts" ON posts
      FOR ALL USING (public.check_admin_user());
  END IF;
END $$;

-- comments 테이블이 있다면 관리자 권한 추가
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comments') THEN
    DROP POLICY IF EXISTS "Admins can manage all comments" ON comments;
    CREATE POLICY "Admins can manage all comments" ON comments
      FOR ALL USING (public.check_admin_user());
  END IF;
END $$;

-- ========================================
-- 6. RLS 활성화 확인
-- ========================================

-- RLS가 활성화되어 있는지 확인하고 활성화
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

-- 기본 권한 정리 (보안 강화)
REVOKE ALL ON member_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON member_profiles TO authenticated;