const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service role client for admin operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Anonymous client for testing user operations
const supabaseAnon = createClient(supabaseUrl, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMDA2MzMsImV4cCI6MjA2NTg3NjYzM30.hkFnngs22eJfoIJP8q_WcgR2uMCT8iK7Z8aQmW46Iwk');

const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a';

async function diagnoseRLSIssues() {
  console.log('🔍 RLS 문제 완전 진단 시작...\n');

  try {
    // 1. 사용자 정보 확인
    console.log('1. 사용자 정보 확인');
    const { data: user, error: userError } = await supabaseAdmin
      .from('auth.users')
      .select('*')
      .eq('id', TARGET_USER_ID)
      .single();

    if (userError) {
      console.log('❌ 사용자 조회 실패:', userError);
    } else {
      console.log('✅ 사용자 정보:', {
        id: user.id,
        email: user.email,
        confirmed_at: user.confirmed_at,
        created_at: user.created_at,
        role: user.role
      });
    }

    // 2. 현재 member_profiles 테이블 RLS 정책 확인
    console.log('\n2. member_profiles 테이블 RLS 정책 확인');
    const { data: policies, error: policiesError } = await supabaseAdmin
      .rpc('get_table_policies', { table_name: 'member_profiles' });

    if (policiesError) {
      console.log('❌ 정책 조회 실패:', policiesError);
    } else {
      console.log('✅ 현재 RLS 정책들:');
      policies.forEach(policy => {
        console.log(`  - ${policy.policyname}: ${policy.cmd} (${policy.qual})`);
      });
    }

    // 3. 테이블 구조 확인
    console.log('\n3. member_profiles 테이블 구조 확인');
    const { data: tableInfo, error: tableError } = await supabaseAdmin
      .rpc('get_table_info', { table_name: 'member_profiles' });

    if (!tableError && tableInfo) {
      console.log('✅ 테이블 구조:', tableInfo);
    }

    // 4. 현재 프로필 데이터 확인
    console.log('\n4. 현재 프로필 데이터 확인');
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from('member_profiles')
      .select('*')
      .eq('user_id', TARGET_USER_ID)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.log('❌ 프로필 조회 실패:', profileError);
    } else if (existingProfile) {
      console.log('✅ 기존 프로필 존재:', existingProfile);
    } else {
      console.log('ℹ️  기존 프로필 없음');
    }

    // 5. RLS 상태 확인
    console.log('\n5. RLS 상태 확인');
    const { data: rlsStatus, error: rlsError } = await supabaseAdmin
      .rpc('check_rls_status', { table_name: 'member_profiles' });

    if (rlsError) {
      console.log('❌ RLS 상태 확인 실패:', rlsError);
    } else {
      console.log('✅ RLS 상태:', rlsStatus);
    }

    // 6. 실제 UPSERT 테스트 (Service Role)
    console.log('\n6. Service Role UPSERT 테스트');
    const testData = {
      user_id: TARGET_USER_ID,
      name: 'Test User',
      phone: '010-1234-5678',
      address: 'Test Address',
      birth_date: '1990-01-01',
      profession: 'Test Profession',
      is_member: false,
      member_number: null,
      application_status: 'pending',
      updated_at: new Date().toISOString()
    };

    const { data: upsertResult, error: upsertError } = await supabaseAdmin
      .from('member_profiles')
      .upsert(testData, { onConflict: 'user_id' })
      .select();

    if (upsertError) {
      console.log('❌ Service Role UPSERT 실패:', upsertError);
    } else {
      console.log('✅ Service Role UPSERT 성공:', upsertResult);
    }

    // 7. 사용자 권한으로 테스트 (실제 사용자 세션 시뮬레이션)
    console.log('\n7. 사용자 권한 테스트');
    
    // 임시 사용자 세션 생성 시도
    const { data: sessionData, error: sessionError } = await supabaseAnon.auth.signInWithPassword({
      email: user?.email || 'test@example.com',
      password: 'temp-password' // 실제로는 올바른 비밀번호가 필요
    });

    if (sessionError) {
      console.log('ℹ️  사용자 세션 생성 실패 (예상됨):', sessionError.message);
    }

    // 8. 정책 세부 분석
    console.log('\n8. 정책 세부 분석');
    const { data: policyDetails, error: policyDetailsError } = await supabaseAdmin
      .rpc('get_detailed_policies', { table_name: 'member_profiles' });

    if (policyDetailsError) {
      console.log('❌ 정책 세부 분석 실패:', policyDetailsError);
    } else {
      console.log('✅ 정책 세부 정보:', policyDetails);
    }

  } catch (error) {
    console.error('❌ 진단 중 오류 발생:', error);
  }
}

async function fixRLSIssues() {
  console.log('\n🔧 RLS 문제 해결 시작...\n');

  try {
    // 1. 기존 정책 모두 삭제
    console.log('1. 기존 정책 삭제');
    const dropPoliciesSQL = `
      DROP POLICY IF EXISTS "member_profiles_select_policy" ON member_profiles;
      DROP POLICY IF EXISTS "member_profiles_insert_policy" ON member_profiles;
      DROP POLICY IF EXISTS "member_profiles_update_policy" ON member_profiles;
      DROP POLICY IF EXISTS "member_profiles_delete_policy" ON member_profiles;
      DROP POLICY IF EXISTS "Users can view own profile" ON member_profiles;
      DROP POLICY IF EXISTS "Users can create own profile" ON member_profiles;
      DROP POLICY IF EXISTS "Users can update own profile" ON member_profiles;
    `;

    const { error: dropError } = await supabaseAdmin.rpc('execute_sql', { sql: dropPoliciesSQL });
    if (dropError) {
      console.log('❌ 정책 삭제 실패:', dropError);
    } else {
      console.log('✅ 기존 정책 삭제 완료');
    }

    // 2. 새로운 정책 생성
    console.log('\n2. 새로운 정책 생성');
    const createPoliciesSQL = `
      -- 사용자가 자신의 프로필을 볼 수 있는 정책
      CREATE POLICY "Users can view own profile" ON member_profiles
      FOR SELECT USING (auth.uid() = user_id);

      -- 사용자가 자신의 프로필을 생성할 수 있는 정책
      CREATE POLICY "Users can create own profile" ON member_profiles
      FOR INSERT WITH CHECK (auth.uid() = user_id);

      -- 사용자가 자신의 프로필을 수정할 수 있는 정책
      CREATE POLICY "Users can update own profile" ON member_profiles
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

      -- 관리자가 모든 프로필을 관리할 수 있는 정책
      CREATE POLICY "Admin can manage all profiles" ON member_profiles
      FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
    `;

    const { error: createError } = await supabaseAdmin.rpc('execute_sql', { sql: createPoliciesSQL });
    if (createError) {
      console.log('❌ 정책 생성 실패:', createError);
    } else {
      console.log('✅ 새로운 정책 생성 완료');
    }

    // 3. RLS 활성화 확인
    console.log('\n3. RLS 활성화 확인');
    const enableRLSSQL = `
      ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;
    `;

    const { error: enableError } = await supabaseAdmin.rpc('execute_sql', { sql: enableRLSSQL });
    if (enableError) {
      console.log('❌ RLS 활성화 실패:', enableError);
    } else {
      console.log('✅ RLS 활성화 완료');
    }

    // 4. 수정 후 테스트
    console.log('\n4. 수정 후 테스트');
    const testData = {
      user_id: TARGET_USER_ID,
      name: 'Updated Test User',
      phone: '010-9999-8888',
      address: 'Updated Test Address',
      birth_date: '1990-01-01',
      profession: 'Updated Test Profession',
      is_member: false,
      member_number: null,
      application_status: 'pending',
      updated_at: new Date().toISOString()
    };

    const { data: testResult, error: testError } = await supabaseAdmin
      .from('member_profiles')
      .upsert(testData, { onConflict: 'user_id' })
      .select();

    if (testError) {
      console.log('❌ 수정 후 테스트 실패:', testError);
    } else {
      console.log('✅ 수정 후 테스트 성공:', testResult);
    }

  } catch (error) {
    console.error('❌ 해결 중 오류 발생:', error);
  }
}

// 실행
async function main() {
  await diagnoseRLSIssues();
  await fixRLSIssues();
}

main().catch(console.error);