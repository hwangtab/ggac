const { createClient } = require('@supabase/supabase-js')

// 이 스크립트는 Supabase Service Role Key가 필요합니다
// 실제 운영 환경에서는 환경 변수로 설정해야 합니다

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co'
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMDA2MzMsImV4cCI6MjA2NTg3NjYzM30.hkFnngs22eJfoIJP8q_WcgR2uMCT8iK7Z8aQmW46Iwk'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a'

async function quickFix() {
  console.log('🔧 빠른 RLS 수정 방법 제공\n')

  // Service Role Key 없이 할 수 있는 진단
  console.log('1. 현재 상황 분석')
  console.log(`   - 대상 사용자: ${TARGET_USER_ID}`)
  console.log(`   - 테이블: member_profiles`)
  console.log(`   - 문제: "new row violates row-level security policy"`)
  console.log(`   - 원인: RLS 정책이 UPSERT 작업을 차단`)

  console.log('\n2. 해결 방법 (Supabase Dashboard에서 실행)')
  console.log('   Supabase Dashboard → SQL Editor에서 다음 SQL 실행:')

  const sqlFix = `
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
WHERE id = '${TARGET_USER_ID}';
`

  console.log('\n=====================================')
  console.log('복사하여 Supabase SQL Editor에서 실행할 SQL:')
  console.log('=====================================')
  console.log(sqlFix)
  console.log('=====================================\n')

  // SQL 파일로 저장
  const fs = require('fs')
  fs.writeFileSync('/Users/hwang-gyeongha/ggac/quick_rls_fix.sql', sqlFix)
  console.log('✅ SQL이 quick_rls_fix.sql 파일로 저장되었습니다.')

  console.log('\n📋 실행 단계:')
  console.log('1. https://supabase.com/dashboard 접속')
  console.log('2. 프로젝트 선택 (btugywkltavbogdnhwpu)')
  console.log('3. 왼쪽 메뉴에서 "SQL Editor" 클릭')
  console.log('4. 위 SQL 코드 복사 → 붙여넣기 → Run 클릭')
  console.log('5. 성공 메시지 확인')
  console.log('6. 웹사이트에서 /register/member-info 페이지 테스트')

  console.log('\n🎯 이 방법으로 해결되지 않으면:')
  console.log('1. 테이블 스키마 확인')
  console.log('2. 트리거 함수 확인')
  console.log('3. 인증 흐름 확인')
}

// 추가: 테스트용 간단한 진단
async function simpleDiagnosis() {
  console.log('\n🔍 간단한 진단 실행')

  try {
    // 테이블 접근 테스트
    const { data, error } = await supabase
      .from('member_profiles')
      .select('id, email, display_name')
      .limit(1)

    if (error) {
      console.log('❌ 테이블 접근 실패:', error.message)
      console.log('   코드:', error.code)
    } else {
      console.log('✅ 테이블 접근 성공')
      console.log('   레코드 수:', data.length)
    }

    // 특정 사용자 조회 테스트
    const { data: userData, error: userError } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('id', TARGET_USER_ID)

    if (userError) {
      console.log('❌ 사용자 조회 실패:', userError.message)
    } else {
      console.log('✅ 사용자 조회 성공')
      console.log('   데이터:', userData)
    }
  } catch (error) {
    console.log('❌ 진단 중 오류:', error.message)
  }
}

async function main() {
  await quickFix()
  await simpleDiagnosis()
}

main().catch(console.error)
