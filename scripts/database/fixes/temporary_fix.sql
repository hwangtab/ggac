-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
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