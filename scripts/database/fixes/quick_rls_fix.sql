-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--

-- Step 1: 기존 정책 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON member_profiles;
DROP POLICY IF EXISTS "Admins can approve members" ON member_profiles;

-- Step 2: RLS 임시 비활성화
ALTER TABLE member_profiles DISABLE ROW LEVEL SECURITY;

-- Step 3: 문제 사용자 프로필 강제 생성
INSERT INTO member_profiles (
  id, email, display_name, phone_number, birth_date, real_name,
  monthly_fee, bank_name, account_number, account_holder,
  registration_status, is_active, is_admin, created_at, updated_at
) VALUES (
  'ab6617b4-532c-4820-8a75-553139868b2a',
  'hwang.kh.sound@gmail.com',
  'Hwang Gyeongha',
  '010-0000-0000',
  '1990-01-01',
  'Hwang Gyeongha',
  10000,
  'Test Bank',
  '123-456-789',
  'Hwang Gyeongha',
  'pending',
  false,
  false,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  updated_at = NOW();

-- Step 4: RLS 다시 활성화
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

-- Step 5: 새로운 정책 생성
CREATE POLICY "Users can view own profile" ON member_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON member_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON member_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Step 6: 검증
SELECT 
  id,
  email,
  display_name,
  registration_status,
  is_active,
  created_at,
  updated_at
FROM member_profiles 
WHERE id = 'ab6617b4-532c-4820-8a75-553139868b2a';
