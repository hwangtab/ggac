-- 경기아트콜렉티브 협동조합 member_profiles RLS 정책 수정
-- 문제: 관리자 정책에서 무한 순환 참조로 인한 "new row violates row-level security policy" 오류 발생
-- 해결: 순환 참조 방지를 위한 정책 재구성

-- ===================================================================
-- 1. 문제가 있는 기존 RLS 정책 모두 삭제
-- ===================================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can approve members" ON public.member_profiles;

-- ===================================================================
-- 2. 기본 사용자 정책 생성 (순환 참조 없음)
-- ===================================================================

-- 사용자는 자신의 프로필을 볼 수 있음
CREATE POLICY "Users can view own profile" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 인증된 사용자는 자신의 프로필을 생성할 수 있음 (회원가입 시)
CREATE POLICY "Users can insert own profile" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 사용자는 자신의 프로필을 수정할 수 있음
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ===================================================================
-- 3. 관리자 기능을 위한 안전한 함수 생성
-- ===================================================================

-- 관리자 체크를 위한 안전한 함수 (순환 참조 방지)
CREATE OR REPLACE FUNCTION public.is_admin_user(user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- RLS를 우회하여 직접 체크 (security definer로 실행)
  RETURN EXISTS (
    SELECT 1 FROM public.member_profiles 
    WHERE id = user_id 
    AND is_admin = true 
    AND is_active = true
  );
END;
$$;

-- ===================================================================
-- 4. 관리자용 정책 (함수 사용하여 순환 참조 방지)
-- ===================================================================

-- 관리자는 모든 프로필을 볼 수 있음
CREATE POLICY "Admins can view all profiles" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id OR public.is_admin_user(auth.uid())
  );

-- 관리자는 모든 프로필을 수정할 수 있음 (회원 승인 등)
CREATE POLICY "Admins can update all profiles" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id OR public.is_admin_user(auth.uid())
  )
  WITH CHECK (
    auth.uid() = id OR public.is_admin_user(auth.uid())
  );

-- ===================================================================
-- 5. 서비스 역할 정책 (백엔드 작업용)
-- ===================================================================

-- 서비스 역할은 모든 프로필에 접근 가능
CREATE POLICY "Service role can access all profiles" ON public.member_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ===================================================================
-- 6. 정책 검증 쿼리 (실행 후 확인용)
-- ===================================================================

-- 현재 정책 상태 확인
SELECT 
    policyname, 
    cmd, 
    roles,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'member_profiles' 
ORDER BY policyname;

-- 특정 사용자가 auth.users에 존재하는지 확인
SELECT 
    id, 
    email, 
    created_at,
    raw_user_meta_data->>'display_name' as display_name
FROM auth.users 
WHERE id = 'ab6617b4-532c-4820-8a75-553139868b2a';

-- 해당 사용자의 프로필 상태 확인
SELECT 
    id,
    email,
    display_name,
    registration_status,
    is_active,
    is_admin,
    created_at
FROM public.member_profiles 
WHERE id = 'ab6617b4-532c-4820-8a75-553139868b2a';

-- ===================================================================
-- 7. 테스트용 프로필 생성 (사용자가 없는 경우)
-- ===================================================================

-- 사용자가 auth.users에 있지만 member_profiles에 없는 경우 수동 생성
INSERT INTO public.member_profiles (
    id, 
    email, 
    display_name, 
    registration_status, 
    is_active
)
SELECT 
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)) as display_name,
    'pending' as registration_status,
    false as is_active
FROM auth.users u
WHERE u.id = 'ab6617b4-532c-4820-8a75-553139868b2a'
AND NOT EXISTS (
    SELECT 1 FROM public.member_profiles mp 
    WHERE mp.id = u.id
)
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    updated_at = NOW();

-- ===================================================================
-- 8. 정책 테스트용 함수 (선택사항)
-- ===================================================================

-- 현재 사용자 정보 확인 함수
CREATE OR REPLACE FUNCTION public.check_current_user()
RETURNS TABLE(
    current_user_id UUID,
    current_role TEXT,
    profile_exists BOOLEAN,
    is_admin BOOLEAN,
    is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        auth.uid() as current_user_id,
        auth.role()::TEXT as current_role,
        EXISTS(SELECT 1 FROM public.member_profiles WHERE id = auth.uid()) as profile_exists,
        COALESCE((SELECT mp.is_admin FROM public.member_profiles mp WHERE mp.id = auth.uid()), false) as is_admin,
        COALESCE((SELECT mp.is_active FROM public.member_profiles mp WHERE mp.id = auth.uid()), false) as is_active;
END;
$$;

-- 실행 완료 메시지
SELECT 'RLS 정책 수정이 완료되었습니다. 이제 사용자가 자신의 프로필을 생성하고 수정할 수 있습니다.' as message;