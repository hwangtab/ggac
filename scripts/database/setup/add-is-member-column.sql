-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- member_profiles 테이블에 is_member 컬럼 추가
-- ===================================================================

-- is_member 컬럼 추가 (기본값 false)
ALTER TABLE public.member_profiles 
ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;

-- 기존 데이터가 있다면 is_member를 true로 설정 (조합원 정보가 있으면 조합원으로 간주)
UPDATE public.member_profiles 
SET is_member = true 
WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;