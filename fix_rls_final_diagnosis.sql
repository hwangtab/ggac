
-- RLS 정책 수정 스크립트
-- 1. 기존 정책 모두 삭제
DROP POLICY IF EXISTS "Users can view own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can create own profile" ON member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON member_profiles;
DROP POLICY IF EXISTS "Admin can manage all profiles" ON member_profiles;

-- 2. RLS 비활성화 (임시)
ALTER TABLE member_profiles DISABLE ROW LEVEL SECURITY;

-- 3. 문제가 있는 사용자의 프로필 직접 생성
INSERT INTO member_profiles (
  user_id, name, phone, address, birth_date, profession, 
  is_member, member_number, application_status, created_at, updated_at
) VALUES (
  'ab6617b4-532c-4820-8a75-553139868b2a', 
  'Pending User', 
  '010-0000-0000', 
  'Pending Address', 
  '1990-01-01', 
  'Pending Profession',
  false, 
  null, 
  'pending', 
  NOW(), 
  NOW()
) ON CONFLICT (user_id) DO UPDATE SET
  updated_at = NOW();

-- 4. RLS 다시 활성화
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;

-- 5. 새로운 정책 생성
CREATE POLICY "Users can view own profile" ON member_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own profile" ON member_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON member_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. 인증된 사용자만 접근 가능하도록 설정
CREATE POLICY "Authenticated users can access" ON member_profiles
  FOR ALL USING (auth.role() = 'authenticated');
