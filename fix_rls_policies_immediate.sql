-- 1. 모든 기존 RLS 정책 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can create own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Service role can access all profiles" ON public.member_profiles;

-- 2. 안전한 관리자 체크 함수 (순환 참조 방지)
CREATE OR REPLACE FUNCTION public.is_admin_user(user_id UUID)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- RLS를 우회하여 직접 체크 (순환 참조 방지)
  RETURN EXISTS (
    SELECT 1 FROM public.member_profiles 
    WHERE id = user_id 
    AND is_admin = true 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- 3. 새로운 RLS 정책 생성 (순환 참조 없음)

-- 사용자는 자신의 프로필만 볼 수 있음
CREATE POLICY "Users can view own profile" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 사용자는 자신의 프로필을 생성할 수 있음
CREATE POLICY "Users can insert own profile" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 사용자는 자신의 프로필을 수정할 수 있음  
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 서비스 역할은 모든 프로필에 접근 가능 (관리 기능용)
CREATE POLICY "Service role can access all profiles" ON public.member_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. RLS 활성화 확인
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;