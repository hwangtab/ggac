const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co'
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMDA2MzMsImV4cCI6MjA2NTg3NjYzM30.hkFnngs22eJfoIJP8q_WcgR2uMCT8iK7Z8aQmW46Iwk'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a'

async function finalDiagnosis() {
  console.log('🔍 최종 RLS 진단 시작...\n')
  console.log(`대상 사용자 ID: ${TARGET_USER_ID}\n`)

  try {
    // 1. 사용자 인증 시도
    console.log('1. 사용자 인증 시도')
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: 'hwang.kh.sound@gmail.com', // 실제 이메일 사용
      password: 'test123!', // 실제 비밀번호 입력 필요
    })

    if (authError) {
      console.log('❌ 인증 실패:', authError.message)
      console.log('   → 실제 사용자 비밀번호로 테스트 필요')
    } else {
      console.log('✅ 인증 성공')

      // 2. 인증된 사용자로 자신의 프로필 조회
      console.log('\n2. 인증된 사용자로 자신의 프로필 조회')
      const { data: profileData, error: profileError } = await supabase
        .from('member_profiles')
        .select('*')
        .eq('id', TARGET_USER_ID)
        .single()

      if (profileError) {
        console.log('❌ 프로필 조회 실패:', profileError.message)
        console.log('   코드:', profileError.code)
        console.log('   상세:', profileError.details)
      } else {
        console.log('✅ 프로필 조회 성공')
        console.log('   기존 프로필:', profileData)
      }

      // 3. 프로필 UPSERT 시도
      console.log('\n3. 프로필 UPSERT 시도')
      const testProfileData = {
        id: TARGET_USER_ID,
        email: 'hwang.kh.sound@gmail.com',
        display_name: 'Test User',
        phone_number: '010-1234-5678',
        birth_date: '1990-01-01',
        real_name: 'Test Real Name',
        monthly_fee: 10000,
        bank_name: 'Test Bank',
        account_number: '123-456-789',
        account_holder: 'Test Holder',
        registration_status: 'pending',
        is_active: false,
        updated_at: new Date().toISOString(),
      }

      const { data: upsertData, error: upsertError } = await supabase
        .from('member_profiles')
        .upsert(testProfileData)

      if (upsertError) {
        console.log('❌ UPSERT 실패:', upsertError.message)
        console.log('   코드:', upsertError.code)
        console.log('   상세:', upsertError.details)
        console.log('   힌트:', upsertError.hint)
      } else {
        console.log('✅ UPSERT 성공')
        console.log('   결과:', upsertData)
      }

      // 4. 로그아웃
      await supabase.auth.signOut()
    }

    // 5. 비인증 상태에서 테스트
    console.log('\n5. 비인증 상태에서 테스트')
    const { data: anonData, error: anonError } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('id', TARGET_USER_ID)
      .single()

    if (anonError) {
      console.log('❌ 비인증 조회 실패:', anonError.message)
      console.log('   → 예상된 결과 (RLS 정상 작동)')
    } else {
      console.log('⚠️  비인증 조회 성공 (RLS 문제 가능성)')
    }
  } catch (error) {
    console.error('❌ 진단 중 예외 발생:', error.message)
  }
}

async function generateCompleteFix() {
  console.log('\n🔧 완전한 RLS 수정 SQL 생성...\n')

  const completeFix = `
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
  '${TARGET_USER_ID}',
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
WHERE id = '${TARGET_USER_ID}';
`

  console.log('완전한 RLS 수정 SQL:')
  console.log('=====================================')
  console.log(completeFix)
  console.log('=====================================\n')

  // SQL 파일로 저장
  const fs = require('fs')
  fs.writeFileSync('/Users/hwang-gyeongha/ggac/complete_rls_fix.sql', completeFix)
  console.log('✅ 완전한 수정 SQL이 complete_rls_fix.sql 파일로 저장되었습니다.')
}

async function main() {
  console.log('🚀 경기아트콜렉티브 협동조합 RLS 최종 진단 및 수정 도구\n')
  console.log('=====================================\n')

  await finalDiagnosis()
  await generateCompleteFix()

  console.log('\n📋 실행 단계:')
  console.log('1. Supabase Dashboard 접속')
  console.log('2. SQL Editor 열기')
  console.log('3. complete_rls_fix.sql 파일 내용 복사하여 실행')
  console.log('4. 웹사이트에서 /register/member-info 페이지 테스트')
  console.log('5. 조합원 정보 입력 및 저장 확인')
  console.log('\n✅ 최종 진단 및 수정 계획이 완료되었습니다.')
}

main().catch(console.error)
