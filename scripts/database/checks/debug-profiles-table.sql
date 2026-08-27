-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- profiles 테이블 상태 확인을 위한 SQL 쿼리들

-- 1. profiles 테이블 구조 확인
\d profiles;

-- 2. RLS 상태 확인
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'profiles';

-- 3. 현재 정책들 확인
SELECT policyname, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'profiles';

-- 4. auth.users 테이블에서 해당 사용자 확인
SELECT id, email, created_at, raw_user_meta_data 
FROM auth.users 
WHERE id = 'b3eeb13d-b51e-496d-b260-3af9326635e1';

-- 5. profiles 테이블의 모든 데이터 확인 (관리자 권한으로)
SELECT * FROM profiles;

-- 6. 특정 사용자의 프로필 확인
SELECT * FROM profiles 
WHERE id = 'b3eeb13d-b51e-496d-b260-3af9326635e1';

-- 7. RLS를 일시적으로 비활성화하고 테스트 (문제 진단용)
-- ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- 8. 현재 auth.uid() 값 확인
SELECT auth.uid();

-- 9. 정책 문제 해결을 위한 새 정책 생성
-- 기존 정책 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Allow inserts for authenticated users" ON profiles;

-- 새로운 정책 생성
CREATE POLICY "Enable read access for authenticated users" ON profiles
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert for authenticated users" ON profiles
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for users based on email" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- 10. 수동으로 프로필 삽입 (테스트용)
INSERT INTO profiles (id, email, display_name, is_member)
VALUES (
    'b3eeb13d-b51e-496d-b260-3af9326635e1',
    (SELECT email FROM auth.users WHERE id = 'b3eeb13d-b51e-496d-b260-3af9326635e1'),
    (SELECT COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)) FROM auth.users WHERE id = 'b3eeb13d-b51e-496d-b260-3af9326635e1'),
    false
)
ON CONFLICT (id) DO NOTHING;