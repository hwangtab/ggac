
-- 완전한 RLS 수정 스크립트
-- 실행 전: Supabase Dashboard → SQL Editor에서 실행

-- 1. 기존 정책 모두 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON member_profiles;
DROP POLICY IF EXISTS "Admins can approve members" ON member_profiles;
DROP POLICY IF EXISTS "Authenticated users can access" ON member_profiles;

-- 2. 사용자 프로필 강제 생성 (RLS 없이)
ALTER TABLE member_profiles DISABLE ROW LEVEL SECURITY;

-- 특정 사용자 프로필 생성/업데이트
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

-- 3. RLS 다시 활성화
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

-- 4. 새로운 정책 생성 (단순하고 명확하게)
CREATE POLICY "Users can view own profile" ON member_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON member_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON member_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 5. 관리자 정책 (필요시)
CREATE POLICY "Admins can view all profiles" ON member_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles admin_profile
      WHERE admin_profile.id = auth.uid()
      AND admin_profile.is_admin = true
      AND admin_profile.is_active = true
    )
  );

-- 6. 검증 쿼리
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
