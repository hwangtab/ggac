// 이메일 인증 시뮬레이션 스크립트
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('🔧 이메일 인증 상태 시뮬레이션 도구');
console.log('\n⚠️ 주의: 이 스크립트는 테스트 목적으로만 사용하세요.');
console.log('실제 환경에서는 Supabase Dashboard SQL Editor에서 다음 SQL을 실행하세요:\n');

console.log('-- 1. 최근 생성된 사용자 확인');
console.log(`SELECT id, email, email_confirmed_at, created_at 
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 5;`);

console.log('\n-- 2. 특정 사용자의 이메일 인증 상태 업데이트 (예시)');
console.log(`UPDATE auth.users 
SET email_confirmed_at = NOW() 
WHERE email = 'test1751889408340@gmail.com';`);

console.log('\n-- 3. member_profiles 테이블 확인');
console.log(`SELECT id, email, display_name, registration_status, created_at 
FROM public.member_profiles 
ORDER BY created_at DESC 
LIMIT 5;`);

console.log('\n-- 4. 수동으로 프로필 생성 (트리거가 실패한 경우)');
console.log(`INSERT INTO public.member_profiles (
  id, email, display_name, real_name, phone_number, birth_date,
  monthly_fee, bank_name, account_number, account_holder,
  registration_status, is_active
) VALUES (
  'c4a1e86e-15a9-464a-8054-626d92119ba7',
  'test1751889408340@gmail.com',
  '테스트사용자',
  '홍길동',
  '010-1234-5678',
  '1990-01-01',
  20000,
  '국민은행',
  '123456-78-901234',
  '홍길동',
  'pending',
  false
);`);

console.log('\n-- 5. 승인 처리 (관리자 작업)');
console.log(`UPDATE public.member_profiles 
SET 
  registration_status = 'approved',
  is_active = true,
  approved_at = NOW()
WHERE email = 'test1751889408340@gmail.com';`);

console.log('\n💡 다음 단계:');
console.log('1. Supabase Dashboard → SQL Editor 접속');
console.log('2. 위의 SQL 명령어들을 순서대로 실행');
console.log('3. 웹사이트에서 로그인 테스트');
console.log('4. 게시판 접근 테스트');

console.log('\n📋 테스트 완료 체크리스트:');
console.log('□ auth.users 테이블에 사용자 생성됨');
console.log('□ 이메일 인증 상태 업데이트됨');
console.log('□ member_profiles 테이블에 프로필 생성됨');
console.log('□ 승인 상태로 변경됨');
console.log('□ 로그인 성공');
console.log('□ 게시판 접근 가능');

// 현재 사용자 확인 함수
async function checkCurrentUsers() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  try {
    console.log('\n🔍 현재 등록된 사용자 확인 (권한 범위 내에서)...');
    
    // 현재 세션이 있는지 확인
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      console.log('✅ 현재 로그인된 사용자:', session.user.email);
    } else {
      console.log('ℹ️ 현재 로그인된 사용자 없음');
    }

    // member_profiles 테이블 확인 시도 (RLS로 인해 제한적)
    const { data: profiles, error } = await supabase
      .from('member_profiles')
      .select('email, display_name, registration_status, created_at')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.log('⚠️ 프로필 조회 제한:', error.message);
    } else {
      console.log('📊 최근 프로필들:', profiles);
    }

  } catch (error) {
    console.log('⚠️ 사용자 확인 중 오류:', error.message);
  }
}

checkCurrentUsers();