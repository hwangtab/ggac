const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co';
// Service Role Key를 수동으로 입력하세요 (Supabase Dashboard → Settings → API)
const serviceRoleKey = 'SERVICE_ROLE_KEY_HERE'; // 실제 키로 교체 필요

const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a';

async function executeRLSFix() {
  console.log('🔧 RLS 수정 실행 중...\n');
  
  // Service Role Key 확인
  if (serviceRoleKey === 'SERVICE_ROLE_KEY_HERE') {
    console.log('❌ Service Role Key가 설정되지 않았습니다.');
    console.log('📋 Service Role Key를 가져오는 방법:');
    console.log('1. Supabase Dashboard 접속');
    console.log('2. Settings → API 메뉴');
    console.log('3. "service_role" 키 복사');
    console.log('4. 이 스크립트의 serviceRoleKey 변수에 붙여넣기');
    console.log('\n⚠️  주의: Service Role Key는 절대 Git에 커밋하지 마세요!');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. 기존 정책 삭제
    console.log('1. 기존 정책 삭제 중...');
    const dropPoliciesSQL = `
      DROP POLICY IF EXISTS "Users can view own profile" ON member_profiles;
      DROP POLICY IF EXISTS "Users can insert own profile" ON member_profiles;
      DROP POLICY IF EXISTS "Users can update own profile" ON member_profiles;
      DROP POLICY IF EXISTS "Admins can view all profiles" ON member_profiles;
      DROP POLICY IF EXISTS "Admins can approve members" ON member_profiles;
      DROP POLICY IF EXISTS "Authenticated users can access" ON member_profiles;
    `;

    const { error: dropError } = await supabase.rpc('exec_sql', { sql: dropPoliciesSQL });
    if (dropError) {
      console.log('❌ 정책 삭제 실패:', dropError.message);
      return;
    }
    console.log('✅ 기존 정책 삭제 완료');

    // 2. RLS 비활성화
    console.log('\n2. RLS 임시 비활성화 중...');
    const { error: disableError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE member_profiles DISABLE ROW LEVEL SECURITY;'
    });
    if (disableError) {
      console.log('❌ RLS 비활성화 실패:', disableError.message);
      return;
    }
    console.log('✅ RLS 비활성화 완료');

    // 3. 사용자 프로필 강제 생성
    console.log('\n3. 사용자 프로필 강제 생성 중...');
    const insertSQL = `
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
    `;

    const { error: insertError } = await supabase.rpc('exec_sql', { sql: insertSQL });
    if (insertError) {
      console.log('❌ 프로필 생성 실패:', insertError.message);
      return;
    }
    console.log('✅ 사용자 프로필 강제 생성 완료');

    // 4. RLS 다시 활성화
    console.log('\n4. RLS 다시 활성화 중...');
    const { error: enableError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;'
    });
    if (enableError) {
      console.log('❌ RLS 활성화 실패:', enableError.message);
      return;
    }
    console.log('✅ RLS 활성화 완료');

    // 5. 새로운 정책 생성
    console.log('\n5. 새로운 정책 생성 중...');
    const createPoliciesSQL = `
      CREATE POLICY "Users can view own profile" ON member_profiles
        FOR SELECT USING (auth.uid() = id);

      CREATE POLICY "Users can insert own profile" ON member_profiles
        FOR INSERT WITH CHECK (auth.uid() = id);

      CREATE POLICY "Users can update own profile" ON member_profiles
        FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

      CREATE POLICY "Admins can view all profiles" ON member_profiles
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM member_profiles admin_profile
            WHERE admin_profile.id = auth.uid()
            AND admin_profile.is_admin = true
            AND admin_profile.is_active = true
          )
        );
    `;

    const { error: createError } = await supabase.rpc('exec_sql', { sql: createPoliciesSQL });
    if (createError) {
      console.log('❌ 정책 생성 실패:', createError.message);
      return;
    }
    console.log('✅ 새로운 정책 생성 완료');

    // 6. 검증
    console.log('\n6. 수정 결과 검증 중...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('member_profiles')
      .select('id, email, display_name, registration_status, is_active, created_at, updated_at')
      .eq('id', TARGET_USER_ID)
      .single();

    if (verifyError) {
      console.log('❌ 검증 실패:', verifyError.message);
      return;
    }
    
    console.log('✅ 검증 성공!');
    console.log('   사용자 프로필:', verifyData);

    console.log('\n🎉 RLS 수정이 완료되었습니다!');
    console.log('📋 다음 단계:');
    console.log('1. 웹사이트에서 /register/member-info 페이지 접속');
    console.log('2. 조합원 정보 입력 및 저장 테스트');
    console.log('3. 성공적으로 저장되는지 확인');

  } catch (error) {
    console.error('❌ RLS 수정 중 예외 발생:', error.message);
  }
}

// 실행 전 안내
console.log('🚀 경기아트콜렉티브 협동조합 RLS 수정 도구\n');
console.log('=====================================\n');
console.log('⚠️  주의사항:');
console.log('1. Service Role Key를 스크립트에 입력해야 합니다');
console.log('2. Service Role Key는 절대 Git에 커밋하지 마세요');
console.log('3. 이 스크립트는 프로덕션 데이터베이스를 수정합니다');
console.log('\n계속하시겠습니까? (y/n)');

// 사용자 입력 대기
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('', (answer) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    executeRLSFix();
  } else {
    console.log('작업이 취소되었습니다.');
  }
  rl.close();
});