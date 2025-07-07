const { chromium } = require('playwright');

async function testDesignPages() {
  console.log('🎨 회원가입 관련 페이지 디자인 확인 테스트\n');

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 2000 // 각 액션 사이에 2초 대기
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();

  try {
    // 1. 회원가입 페이지 확인
    console.log('1️⃣ 회원가입 페이지 디자인 확인...');
    await page.goto('http://localhost:3000/signup');
    await page.waitForTimeout(3000);
    
    console.log('   ✅ 회원가입 페이지 로딩 완료');
    console.log('   📸 스크린샷 저장: signup-page-design.png');
    await page.screenshot({ 
      path: 'signup-page-design.png', 
      fullPage: true 
    });

    // 2. 로그인 페이지 확인
    console.log('\n2️⃣ 로그인 페이지 디자인 확인...');
    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(3000);
    
    console.log('   ✅ 로그인 페이지 로딩 완료');
    console.log('   📸 스크린샷 저장: login-page-design.png');
    await page.screenshot({ 
      path: 'login-page-design.png', 
      fullPage: true 
    });

    // 3. 승인 대기 페이지 확인
    console.log('\n3️⃣ 승인 대기 페이지 디자인 확인...');
    await page.goto('http://localhost:3000/register/pending');
    await page.waitForTimeout(3000);
    
    console.log('   ✅ 승인 대기 페이지 로딩 완료');
    console.log('   📸 스크린샷 저장: pending-page-design.png');
    await page.screenshot({ 
      path: 'pending-page-design.png', 
      fullPage: true 
    });

    // 4. 거절 페이지 확인
    console.log('\n4️⃣ 거절 페이지 디자인 확인...');
    await page.goto('http://localhost:3000/register/rejected');
    await page.waitForTimeout(3000);
    
    console.log('   ✅ 거절 페이지 로딩 완료');
    console.log('   📸 스크린샷 저장: rejected-page-design.png');
    await page.screenshot({ 
      path: 'rejected-page-design.png', 
      fullPage: true 
    });

    // 5. 반응형 디자인 테스트 (모바일)
    console.log('\n5️⃣ 모바일 반응형 디자인 확인...');
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    
    await page.goto('http://localhost:3000/signup');
    await page.waitForTimeout(2000);
    console.log('   📱 모바일 회원가입 페이지 스크린샷: signup-mobile.png');
    await page.screenshot({ 
      path: 'signup-mobile.png', 
      fullPage: true 
    });

    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(2000);
    console.log('   📱 모바일 로그인 페이지 스크린샷: login-mobile.png');
    await page.screenshot({ 
      path: 'login-mobile.png', 
      fullPage: true 
    });

    // 6. 폼 인터랙션 테스트
    console.log('\n6️⃣ 폼 인터랙션 테스트...');
    await page.setViewportSize({ width: 1280, height: 720 }); // 데스크톱으로 복원
    await page.goto('http://localhost:3000/signup');
    await page.waitForTimeout(2000);

    // 필드에 포커스할 때 스타일 변화 확인
    await page.focus('input[name="email"]');
    await page.waitForTimeout(1000);
    console.log('   ✅ 이메일 필드 포커스 스타일 확인');

    await page.focus('input[name="password"]');
    await page.waitForTimeout(1000);
    console.log('   ✅ 비밀번호 필드 포커스 스타일 확인');

    // 일부 데이터 입력
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="displayName"]', '테스트사용자');
    await page.waitForTimeout(1000);
    
    console.log('   📸 폼 입력 상태 스크린샷: form-interaction.png');
    await page.screenshot({ 
      path: 'form-interaction.png', 
      fullPage: true 
    });

    console.log('\n🎉 디자인 테스트 완료!');
    console.log('\n📋 생성된 스크린샷:');
    console.log('- signup-page-design.png (데스크톱 회원가입)');
    console.log('- login-page-design.png (데스크톱 로그인)');
    console.log('- pending-page-design.png (승인 대기)');
    console.log('- rejected-page-design.png (거절 페이지)');
    console.log('- signup-mobile.png (모바일 회원가입)');
    console.log('- login-mobile.png (모바일 로그인)');
    console.log('- form-interaction.png (폼 인터랙션)');

  } catch (error) {
    console.error('❌ 테스트 중 오류 발생:', error.message);
  } finally {
    console.log('\n⏸️ 브라우저를 열어둡니다. 수동으로 확인 후 닫아주세요.');
    // await browser.close();
  }
}

if (require.main === module) {
  testDesignPages().catch(console.error);
}

module.exports = { testDesignPages };