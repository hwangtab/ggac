-- RLS 정책 무한 순환 오류 해결
-- ===================================================================

-- 1. 기존 RLS 정책 모두 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.member_profiles;

-- 2. INSERT 정책 추가 (프로필 생성용)
CREATE POLICY "Allow authenticated users to create profiles" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 3. 사용자는 자신의 프로필만 볼 수 있음
CREATE POLICY "Users can view own profile" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 4. 사용자는 자신의 프로필만 수정할 수 있음  
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5. 서비스 역할은 모든 프로필에 접근 가능 (관리자 기능용)
CREATE POLICY "Service role can access all profiles" ON public.member_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 6. 대안: 관리자 체크를 위한 별도 함수 생성
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- RLS를 우회하여 직접 체크
  RETURN EXISTS (
    SELECT 1 FROM public.member_profiles 
    WHERE id = user_id 
    AND is_admin = true 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- 7. 관리자용 정책 (함수 사용)
CREATE POLICY "Admins can view all profiles" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id OR public.is_admin(auth.uid())
  );

CREATE POLICY "Admins can update all profiles" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    auth.uid() = id OR public.is_admin(auth.uid())
  );