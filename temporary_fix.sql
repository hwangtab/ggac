-- 임시 해결책: RLS 정책 단순화
-- ===================================================================

-- 1. 모든 RLS 정책 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to create profiles" ON public.member_profiles;

-- 2. 간단한 정책만 적용
-- 인증된 사용자는 모든 프로필을 볼 수 있음 (일단 테스트용)
CREATE POLICY "Authenticated users can view profiles" ON public.member_profiles
  FOR SELECT TO authenticated
  USING (true);

-- 사용자는 자신의 프로필만 수정 가능
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 프로필 생성 허용
CREATE POLICY "Users can create own profile" ON public.member_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);