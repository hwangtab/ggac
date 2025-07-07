// 경기아트콜렉티브 협동조합 RLS 정책 진단 및 수정 스크립트
// 사용법: node diagnose_and_fix_rls.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

// Supabase 클라이언트 설정
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // 서비스 키 필요
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TARGET_USER_ID = 'ab6617b4-532c-4820-8a75-553139868b2a';

async function diagnoseRLSIssues() {
    console.log('🔍 RLS 정책 진단을 시작합니다...\n');
    
    try {
        // 1. 사용자가 auth.users에 존재하는지 확인
        console.log('1. auth.users 테이블에서 사용자 확인...');
        const { data: authUser, error: authError } = await supabase
            .from('auth.users')
            .select('id, email, created_at, raw_user_meta_data')
            .eq('id', TARGET_USER_ID)
            .single();
        
        if (authError || !authUser) {
            console.log('❌ 사용자가 auth.users에 존재하지 않습니다.');
            console.log('오류:', authError?.message || '사용자 없음');
            return;
        }
        
        console.log('✅ 사용자가 auth.users에 존재합니다:');
        console.log(`   - ID: ${authUser.id}`);
        console.log(`   - Email: ${authUser.email}`);
        console.log(`   - 생성일: ${authUser.created_at}`);
        console.log('');
        
        // 2. member_profiles 테이블 구조 확인
        console.log('2. member_profiles 테이블 구조 확인...');
        const { data: profileData, error: profileError } = await supabase
            .from('member_profiles')
            .select('*')
            .eq('id', TARGET_USER_ID)
            .single();
        
        if (profileError && profileError.code !== 'PGRST116') {
            console.log('❌ member_profiles 조회 중 오류 발생:');
            console.log('   오류 코드:', profileError.code);
            console.log('   오류 메시지:', profileError.message);
            
            if (profileError.message.includes('row-level security policy')) {
                console.log('   → RLS 정책 위반으로 인한 오류입니다.');
            }
        } else if (!profileData) {
            console.log('⚠️ 사용자 프로필이 member_profiles에 존재하지 않습니다.');
        } else {
            console.log('✅ 사용자 프로필이 member_profiles에 존재합니다:');
            console.log(`   - 표시 이름: ${profileData.display_name}`);
            console.log(`   - 등록 상태: ${profileData.registration_status}`);
            console.log(`   - 활성 상태: ${profileData.is_active}`);
            console.log(`   - 관리자: ${profileData.is_admin}`);
        }
        console.log('');
        
        // 3. 현재 RLS 정책 확인
        console.log('3. 현재 RLS 정책 확인...');
        const { data: policies, error: policyError } = await supabase
            .rpc('exec_sql', {
                sql: `
                    SELECT policyname, cmd, roles, qual, with_check 
                    FROM pg_policies 
                    WHERE tablename = 'member_profiles' 
                    ORDER BY policyname;
                `
            });
        
        if (policyError) {
            console.log('❌ RLS 정책 조회 중 오류:', policyError.message);
        } else {
            console.log('✅ 현재 RLS 정책:');
            policies.forEach(policy => {
                console.log(`   - ${policy.policyname} (${policy.cmd})`);
                console.log(`     역할: ${policy.roles}`);
                console.log(`     조건: ${policy.qual || 'N/A'}`);
                console.log(`     체크: ${policy.with_check || 'N/A'}`);
            });
        }
        console.log('');
        
        // 4. 진단 결과 요약
        console.log('📊 진단 결과 요약:');
        console.log('=====================================');
        
        if (authUser && !profileData) {
            console.log('❌ 문제: 사용자가 auth.users에는 있지만 member_profiles에는 없음');
            console.log('💡 해결책: 프로필을 수동으로 생성하거나 트리거 함수 확인');
        } else if (profileError && profileError.message.includes('row-level security policy')) {
            console.log('❌ 문제: RLS 정책 위반 (순환 참조 가능성)');
            console.log('💡 해결책: RLS 정책 재구성 필요');
        } else {
            console.log('✅ 기본 설정은 정상적으로 보입니다.');
        }
        
    } catch (error) {
        console.error('❌ 진단 중 예외 발생:', error.message);
    }
}

async function fixRLSPolicies() {
    console.log('\n🔧 RLS 정책 수정을 시작합니다...\n');
    
    try {
        // SQL 파일 읽기
        const sqlContent = fs.readFileSync('./fix_rls_policies_final.sql', 'utf-8');
        
        // SQL 실행
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: sqlContent
        });
        
        if (error) {
            console.log('❌ RLS 정책 수정 중 오류 발생:');
            console.log('   오류:', error.message);
            return false;
        }
        
        console.log('✅ RLS 정책 수정이 완료되었습니다.');
        return true;
        
    } catch (error) {
        console.error('❌ RLS 정책 수정 중 예외 발생:', error.message);
        return false;
    }
}

async function testProfileCreation() {
    console.log('\n🧪 프로필 생성 테스트를 시작합니다...\n');
    
    try {
        // 테스트용 사용자로 프로필 생성 시도
        const { data, error } = await supabase
            .from('member_profiles')
            .upsert({
                id: TARGET_USER_ID,
                email: 'test@example.com',
                display_name: 'Test User',
                registration_status: 'pending',
                is_active: false
            }, {
                onConflict: 'id'
            });
        
        if (error) {
            console.log('❌ 프로필 생성/수정 테스트 실패:');
            console.log('   오류:', error.message);
            return false;
        }
        
        console.log('✅ 프로필 생성/수정 테스트 성공');
        return true;
        
    } catch (error) {
        console.error('❌ 프로필 생성 테스트 중 예외 발생:', error.message);
        return false;
    }
}

async function main() {
    console.log('🚀 경기아트콜렉티브 협동조합 RLS 정책 진단 및 수정 도구\n');
    console.log('=====================================\n');
    
    // 1. 진단 실행
    await diagnoseRLSIssues();
    
    // 2. 사용자 확인 후 수정 진행
    console.log('\n계속하려면 Enter를 누르세요...');
    process.stdin.once('data', async () => {
        // 3. RLS 정책 수정
        const fixSuccess = await fixRLSPolicies();
        
        if (fixSuccess) {
            // 4. 테스트 실행
            await testProfileCreation();
            
            // 5. 재진단
            console.log('\n🔄 수정 후 재진단을 실행합니다...\n');
            await diagnoseRLSIssues();
        }
        
        console.log('\n🎉 작업이 완료되었습니다.');
        process.exit(0);
    });
}

// 환경 변수 체크
if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

main().catch(console.error);