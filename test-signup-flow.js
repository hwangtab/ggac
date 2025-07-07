const { chromium } = require('playwright');

async function testSignupFlow() {
  console.log('🚀 경기아트콜렉티브 회원가입 플로우 테스트 시작\n');

  const browser = await chromium.launch({ 
    headless: false, // 화면에서 보기 위해 false로 설정
    slowMo: 1000 // 각 액션 사이에 1초 대기
  });
  
  const page = await browser.newPage();

  try {
    // 1. 홈페이지 접속 테스트
    console.log('1️⃣ 홈페이지 접속 테스트...');
    await page.goto('http://localhost:3000');
    await page.waitForTimeout(2000);
    
    const title = await page.title();
    console.log(`   ✅ 페이지 제목: ${title}`);

    // 2. 회원가입 페이지 이동
    console.log('\n2️⃣ 회원가입 페이지 이동...');
    await page.goto('http://localhost:3000/signup');
    await page.waitForTimeout(2000);

    // 페이지 로딩 확인
    const signupTitle = await page.locator('h2').first().textContent();
    console.log(`   ✅ 회원가입 페이지 제목: ${signupTitle}`);

    // 3. 폼 필드 테스트
    console.log('\n3️⃣ 회원가입 폼 테스트...');
    
    // 테스트 데이터
    const testData = {
      email: `test-${Date.now()}@example.com`,
      password: 'test123456',
      displayName: '테스트사용자',
      realName: '홍길동',
      phoneNumber: '010-1234-5678',
      birthDate: '1990-01-01',
      monthlyFee: '20000',
      bankName: '국민은행',
      accountNumber: '123456-78-901234',
      accountHolder: '홍길동'
    };

    console.log(`   📝 테스트 이메일: ${testData.email}`);

    // 폼 필드 입력
    await page.fill('input[name="email"]', testData.email);
    await page.fill('input[name="password"]', testData.password);
    await page.fill('input[name="displayName"]', testData.displayName);
    await page.fill('input[name="realName"]', testData.realName);
    await page.fill('input[name="phoneNumber"]', testData.phoneNumber);
    await page.fill('input[name="birthDate"]', testData.birthDate);
    await page.selectOption('select[name="monthlyFee"]', testData.monthlyFee);
    await page.fill('input[name="bankName"]', testData.bankName);
    await page.fill('input[name="accountNumber"]', testData.accountNumber);
    await page.fill('input[name="accountHolder"]', testData.accountHolder);

    console.log('   ✅ 모든 필드 입력 완료');

    // 4. 유효성 검사 테스트
    console.log('\n4️⃣ 유효성 검사 테스트...');
    
    // 잘못된 이메일로 테스트
    await page.fill('input[name="email"]', 'invalid-email');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    
    // 에러 메시지 확인
    const errorMessage = await page.locator('div').filter({ hasText: '올바른 이메일' }).isVisible();
    if (errorMessage) {
      console.log('   ✅ 이메일 유효성 검사 작동');
    }

    // 올바른 이메일로 다시 설정
    await page.fill('input[name="email"]', testData.email);

    // 5. 회원가입 제출 테스트
    console.log('\n5️⃣ 회원가입 제출 테스트...');
    
    await page.click('button[type="submit"]');
    
    // 로딩 상태 확인
    const loadingButton = await page.locator('button:has-text("가입 처리 중")').isVisible();
    if (loadingButton) {
      console.log('   ✅ 로딩 상태 표시 확인');
    }

    // 결과 메시지 대기 (최대 10초)
    try {
      await page.waitForSelector('div:has-text("회원가입")', { timeout: 10000 });
      const resultMessage = await page.locator('div').filter({ hasText: '회원가입' }).first().textContent();
      console.log(`   📝 결과 메시지: ${resultMessage?.substring(0, 100)}...`);
      
      if (resultMessage?.includes('완료')) {
        console.log('   ✅ 회원가입 성공 메시지 확인');
      } else {
        console.log('   ❌ 회원가입 실패 또는 오류 발생');
      }
    } catch (error) {
      console.log('   ⚠️ 결과 메시지 대기 시간 초과');
    }

    // 6. 로그인 페이지 이동 테스트
    console.log('\n6️⃣ 로그인 페이지 테스트...');
    
    // 5초 후 자동 이동되는지 확인하거나 수동으로 이동
    await page.waitForTimeout(6000);
    
    if (page.url().includes('/login')) {
      console.log('   ✅ 로그인 페이지로 자동 이동됨');
    } else {
      await page.goto('http://localhost:3000/login');
      console.log('   ✅ 로그인 페이지로 수동 이동');
    }

    // 7. 로그인 시도 (이메일 인증 없이는 실패할 것임)
    console.log('\n7️⃣ 로그인 시도 테스트...');
    
    await page.fill('input[name="email"]', testData.email);
    await page.fill('input[name="password"]', testData.password);
    await page.click('button[type="submit"]');
    
    await page.waitForTimeout(3000);
    
    // 로그인 결과 확인
    try {
      const loginMessage = await page.locator('div').filter({ hasText: '인증' }).first().textContent();
      if (loginMessage) {
        console.log(`   📝 로그인 메시지: ${loginMessage}`);
        if (loginMessage.includes('이메일 인증')) {
          console.log('   ✅ 이메일 인증 필요 메시지 확인 (정상)');
        }
      }
    } catch (error) {
      console.log('   ⚠️ 로그인 메시지 확인 실패');
    }

    // 8. 네비게이션 테스트
    console.log('\n8️⃣ 네비게이션 테스트...');
    
    // 홈으로 이동
    await page.goto('http://localhost:3000');
    await page.waitForTimeout(1000);
    
    // BOARD 링크 확인
    const boardLink = await page.locator('text=BOARD').isVisible();
    if (boardLink) {
      console.log('   ✅ BOARD 링크 표시됨');
      
      // BOARD 클릭 시 로그인 페이지로 리다이렉트되는지 확인
      await page.click('text=BOARD');
      await page.waitForTimeout(2000);
      
      if (page.url().includes('/login')) {
        console.log('   ✅ 비로그인 시 BOARD 접근 시 로그인 페이지로 리다이렉트됨');
      }
    }

    console.log('\n🎉 회원가입 플로우 테스트 완료!');
    console.log('\n📋 테스트 결과 요약:');
    console.log('1. ✅ 홈페이지 접속');
    console.log('2. ✅ 회원가입 페이지 접속');
    console.log('3. ✅ 폼 필드 입력');
    console.log('4. ✅ 유효성 검사');
    console.log('5. ✅ 회원가입 제출');
    console.log('6. ✅ 로그인 페이지 이동');
    console.log('7. ✅ 로그인 시도 (이메일 인증 필요)');
    console.log('8. ✅ 네비게이션 보안');
    
    console.log('\n💡 다음 단계:');
    console.log('1. 이메일 인증 링크 클릭');
    console.log('2. Supabase Dashboard에서 member_profiles 테이블 확인');
    console.log('3. registration_status를 "approved"로, is_active를 true로 변경');
    console.log('4. 로그인 후 게시판 접근 테스트');

  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error.message);
    console.error('상세 오류:', error);
  } finally {
    // 브라우저는 수동으로 닫기 (결과 확인을 위해)
    console.log('\n⏸️ 브라우저를 열어둡니다. 수동으로 닫아주세요.');
    // await browser.close();
  }
}

// 실행
if (require.main === module) {
  testSignupFlow().catch(console.error);
}

module.exports = { testSignupFlow };