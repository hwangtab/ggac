const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMDA2MzMsImV4cCI6MjA2NTg3NjYzM30.hkFnngs22eJfoIJP8q_WcgR2uMCT8iK7Z8aQmW46Iwk';

// Anonymous 클라이언트 생성
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a';

async function diagnoseRLSIssues() {
  console.log('🔍 RLS 문제 진단 시작...\n');

  try {
    // 1. 테이블 존재 확인
    console.log('1. member_profiles 테이블 접근 테스트');
    const { data: tableTest, error: tableError } = await supabase
      .from('member_profiles')
      .select('count(*)', { count: 'exact' })
      .limit(1);

    if (tableError) {
      console.log('❌ 테이블 접근 실패:', tableError.message);
      console.log('   코드:', tableError.code);
      console.log('   상세:', tableError.details);
    } else {
      console.log('✅ 테이블 접근 성공');
    }

    // 2. 특정 사용자 프로필 조회 시도
    console.log('\n2. 특정 사용자 프로필 조회 시도');
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('user_id', TARGET_USER_ID)
      .single();

    if (profileError) {
      console.log('❌ 프로필 조회 실패:', profileError.message);
      console.log('   코드:', profileError.code);
      if (profileError.message.includes('row-level security policy')) {
        console.log('   → RLS 정책 위반 확인됨');
      }
    } else if (profile) {
      console.log('✅ 프로필 조회 성공:', profile);
    } else {
      console.log('ℹ️  프로필 데이터 없음');
    }

    // 3. 임시 사용자 생성 및 인증 시도
    console.log('\n3. 임시 사용자 생성 및 인증 시도');
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: 'test-diagnosis@example.com',
      password: 'tempPassword123!'
    });

    if (signUpError) {
      console.log('❌ 임시 사용자 생성 실패:', signUpError.message);
    } else {
      console.log('✅ 임시 사용자 생성 성공');
      const tempUserId = signUpData.user?.id;
      
      if (tempUserId) {
        // 4. 인증된 사용자로 프로필 생성 시도
        console.log('\n4. 인증된 사용자로 프로필 생성 시도');
        const { data: insertData, error: insertError } = await supabase
          .from('member_profiles')
          .insert({
            user_id: tempUserId,
            name: 'Test User',
            phone: '010-1234-5678',
            address: 'Test Address',
            birth_date: '1990-01-01',
            profession: 'Test Profession',
            is_member: false,
            member_number: null,
            application_status: 'pending'
          });

        if (insertError) {
          console.log('❌ 프로필 생성 실패:', insertError.message);
          console.log('   코드:', insertError.code);
          console.log('   상세:', insertError.details);
        } else {
          console.log('✅ 프로필 생성 성공:', insertData);
        }

        // 5. 임시 사용자 로그아웃
        await supabase.auth.signOut();
      }
    }

    // 6. 데이터베이스 스키마 정보 확인
    console.log('\n6. 데이터베이스 스키마 정보 확인');
    const { data: schemaInfo, error: schemaError } = await supabase
      .rpc('get_schema_info');

    if (schemaError) {
      console.log('❌ 스키마 정보 조회 실패:', schemaError.message);
    } else {
      console.log('✅ 스키마 정보 조회 성공');
    }

  } catch (error) {
    console.error('❌ 진단 중 예외 발생:', error.message);
  }
}

async function generateRLSFixSQL() {
  console.log('\n🔧 RLS 수정 SQL 생성...\n');

  const fixSQL = `
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
  '${TARGET_USER_ID}', 
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
`;

  console.log('생성된 SQL 스크립트:');
  console.log('=====================================');
  console.log(fixSQL);
  console.log('=====================================\n');

  // SQL 파일로 저장
  const fs = require('fs');
  fs.writeFileSync('/Users/hwang-gyeongha/ggac/fix_rls_final_diagnosis.sql', fixSQL);
  console.log('✅ SQL 스크립트가 fix_rls_final_diagnosis.sql 파일로 저장되었습니다.');
}

async function main() {
  console.log('🚀 경기아트콜렉티브 협동조합 RLS 문제 진단 도구\n');
  console.log('=====================================\n');

  await diagnoseRLSIssues();
  await generateRLSFixSQL();

  console.log('\n📝 다음 단계:');
  console.log('1. Supabase Dashboard에서 SQL Editor 열기');
  console.log('2. fix_rls_final_diagnosis.sql 파일 내용 복사');
  console.log('3. SQL Editor에서 실행');
  console.log('4. 웹사이트에서 다시 테스트');
  console.log('\n🎉 진단이 완료되었습니다.');
}

main().catch(console.error);