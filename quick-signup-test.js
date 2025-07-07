// 빠른 회원가입 테스트 - 콘솔에서 오류 확인
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSignup() {
  console.log('🧪 간단한 회원가입 테스트 시작...\n');

  const testData = {
    email: `test${Date.now()}@gmail.com`,
    password: 'test123456',
    options: {
      data: {
        display_name: '테스트사용자',
        real_name: '홍길동',
        phone_number: '010-1234-5678',
        birth_date: '1990-01-01',
        monthly_fee: 20000,
        bank_name: '국민은행',
        account_number: '123456-78-901234',
        account_holder: '홍길동'
      }
    }
  };

  console.log(`📧 테스트 이메일: ${testData.email}`);
  console.log('📝 메타데이터:', testData.options.data);

  try {
    console.log('\n🚀 회원가입 시도...');
    const { data, error } = await supabase.auth.signUp(testData);

    if (error) {
      console.error('❌ 회원가입 오류:', error.message);
      console.error('상세 오류:', error);
      return;
    }

    console.log('✅ 회원가입 성공!');
    console.log('👤 사용자 정보:', {
      id: data.user?.id,
      email: data.user?.email,
      email_confirmed_at: data.user?.email_confirmed_at,
      user_metadata: data.user?.user_metadata
    });

    // 5초 후 프로필 확인
    console.log('\n⏳ 5초 후 프로필 생성 확인...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('id', data.user?.id)
      .single();

    if (profileError) {
      console.error('❌ 프로필 조회 오류:', profileError.message);
      console.error('상세:', profileError);
    } else {
      console.log('✅ 프로필 생성 확인:');
      console.log({
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        real_name: profile.real_name,
        registration_status: profile.registration_status,
        is_active: profile.is_active,
        created_at: profile.created_at
      });
    }

  } catch (error) {
    console.error('❌ 예상치 못한 오류:', error);
  }
}

testSignup();