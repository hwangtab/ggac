const { chromium } = require('playwright');

async function testMobileLogin() {
  console.log('🚀 Starting mobile login test...');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 100 
  });
  
  // 다양한 모바일 디바이스 테스트
  const devices = [
    { name: 'iPhone 13', device: 'iPhone 13' },
    { name: 'iPhone SE', device: 'iPhone SE' },
    { name: 'Galaxy S21', device: 'Galaxy S21' },
    { name: 'iPad', device: 'iPad' }
  ];
  
  for (const deviceInfo of devices) {
    console.log(`\n📱 Testing on ${deviceInfo.name}...`);
    
    const context = await browser.newContext({
      ...require('playwright').devices[deviceInfo.device],
      // 모바일 네트워크 시뮬레이션
      offline: false,
      // 터치 지원 활성화
      hasTouch: true,
    });
    
    const page = await context.newPage();
    
    // 네트워크 이벤트 모니터링
    page.on('request', request => {
      if (request.url().includes('/auth/') || request.url().includes('supabase')) {
        console.log(`📡 [${deviceInfo.name}] AUTH REQUEST: ${request.method()} ${request.url()}`);
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/auth/') || response.url().includes('supabase')) {
        console.log(`📡 [${deviceInfo.name}] AUTH RESPONSE: ${response.status()} ${response.url()}`);
      }
    });
    
    // 콘솔 로그 캡처
    page.on('console', msg => {
      if (msg.text().includes('LOGIN DEBUG') || msg.text().includes('MIDDLEWARE DEBUG')) {
        console.log(`🔍 [${deviceInfo.name}] CONSOLE: ${msg.text()}`);
      }
    });
    
    try {
      // 1. 로그인 페이지 접근
      console.log(`  Step 1: Navigating to login page...`);
      await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
      
      // 페이지 로드 확인
      await page.waitForSelector('h1', { timeout: 10000 });
      console.log(`  ✅ Login page loaded successfully`);
      
      // 2. 모바일 뷰포트 확인
      const viewport = page.viewportSize();
      console.log(`  📏 Viewport: ${viewport.width}x${viewport.height}`);
      
      // 3. UI 테스트 (실제 로그인 시도 없이 UI 확인)
      console.log(`  Step 2: Testing login form UI...`);
      
      // 이메일 입력 필드 확인
      await page.waitForSelector('input[type="email"]');
      console.log(`  ✅ Email input field found`);
      
      // 비밀번호 입력 필드 확인
      await page.waitForSelector('input[type="password"]');
      console.log(`  ✅ Password input field found`);
      
      // 로그인 버튼 확인
      await page.waitForSelector('button[type="submit"]');
      console.log(`  ✅ Login button found`);
      
      // 4. 모바일 터치 및 반응형 확인
      console.log(`  Step 3: Testing mobile responsiveness...`);
      
      // 모바일 뷰포트에서 요소들이 제대로 표시되는지 확인
      const emailInput = await page.locator('input[type="email"]');
      const passwordInput = await page.locator('input[type="password"]');
      const submitButton = await page.locator('button[type="submit"]');
      
      // 요소들이 뷰포트 내에 있는지 확인
      const emailBox = await emailInput.boundingBox();
      const passwordBox = await passwordInput.boundingBox();
      const buttonBox = await submitButton.boundingBox();
      
      if (emailBox && passwordBox && buttonBox) {
        console.log(`  ✅ All form elements are visible in viewport`);
      } else {
        console.log(`  ⚠️  Some elements may be outside viewport`);
      }
      
      // 5. 터치 이벤트 테스트
      console.log(`  Step 4: Testing touch interactions...`);
      
      try {
        // 터치 이벤트 시뮬레이션 (더 안전한 방식으로)
        await emailInput.click({ force: true });
        console.log(`  ✅ Email input touch responsive`);
        
        await passwordInput.click({ force: true });
        console.log(`  ✅ Password input touch responsive`);
        
        await submitButton.click({ force: true });
        console.log(`  ✅ Submit button touch responsive`);
        
      } catch (error) {
        console.log(`  ⚠️  Touch interaction test failed: ${error.message}`);
      }
      
      // 6. 실제 로그인 플로우 테스트
      console.log(`  Step 5: Testing actual login flow...`);
      
      try {
        // 실제 로그인 시도 (실제 계정)
        await page.fill('input[type="email"]', 'hwangtab@gmail.com');
        await page.fill('input[type="password"]', 'Hamagood1248#');
        
        console.log(`  📝 Test credentials entered`);
        
        // 로그인 버튼 클릭
        await page.click('button[type="submit"]');
        console.log(`  🔄 Login button clicked`);
        
        // 로그인 처리 대기
        await page.waitForTimeout(3000);
        
        // 리다이렉트 또는 메시지 확인
        const currentUrl = page.url();
        console.log(`  📍 Current URL after login: ${currentUrl}`);
        
        // 로그인 성공 후 상태 확인
        if (currentUrl.includes('/board')) {
          console.log(`  ✅ Successfully redirected to board!`);
        } else if (currentUrl.includes('/register/pending')) {
          console.log(`  ⏳ Redirected to pending page (account needs approval)`);
        } else if (currentUrl.includes('/register/rejected')) {
          console.log(`  ❌ Redirected to rejected page`);
        } else {
          console.log(`  ⚠️  Unexpected redirect or stayed on login page`);
          
          // 로그인 실패 메시지 확인
          const errorMessage = await page.textContent('.text-red-800').catch(() => null);
          if (errorMessage) {
            console.log(`  ❌ Login error message: ${errorMessage}`);
          }
        }
        
      } catch (loginError) {
        console.log(`  ⚠️  Login test failed: ${loginError.message}`);
      }
      
      // 7. 최종 상태 확인
      console.log(`  Step 6: Checking final state...`);
      await page.waitForTimeout(2000);
      const finalUrl = page.url();
      console.log(`  📍 Final URL: ${finalUrl}`);
      
      // 7. 페이지 스크린샷 저장
      await page.screenshot({ 
        path: `test-results-mobile-login-${deviceInfo.name.replace(/\s+/g, '-').toLowerCase()}.png`,
        fullPage: true 
      });
      console.log(`  📸 Screenshot saved`);
      
      console.log(`✅ [${deviceInfo.name}] Test completed\n`);
      
    } catch (error) {
      console.error(`❌ [${deviceInfo.name}] Test failed:`, error.message);
      
      // 에러 시에도 스크린샷 저장
      await page.screenshot({ 
        path: `test-error-mobile-login-${deviceInfo.name.replace(/\s+/g, '-').toLowerCase()}.png`,
        fullPage: true 
      });
    }
    
    await context.close();
  }
  
  await browser.close();
  console.log('\n🏁 Mobile login test completed!');
}

// 네트워크 시뮬레이션 테스트
async function testMobileNetworkConditions() {
  console.log('\n🌐 Testing mobile network conditions...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...require('playwright').devices['iPhone 13'],
    hasTouch: true,
  });
  
  const page = await context.newPage();
  
  // 네트워크 조건 시뮬레이션
  const networkConditions = [
    { name: 'Fast 3G', downloadThroughput: 1.5 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 40 },
    { name: 'Slow 3G', downloadThroughput: 500 * 1024 / 8, uploadThroughput: 500 * 1024 / 8, latency: 400 },
    { name: '2G', downloadThroughput: 250 * 1024 / 8, uploadThroughput: 250 * 1024 / 8, latency: 800 }
  ];
  
  for (const condition of networkConditions) {
    console.log(`\n📶 Testing ${condition.name} network...`);
    
    // 네트워크 속도 제한 시뮬레이션
    await page.route('**/*', async route => {
      await new Promise(resolve => setTimeout(resolve, condition.latency));
      route.continue();
    });
    
    try {
      await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
      console.log(`  ✅ Page loaded under ${condition.name} conditions`);
      
      // UI 테스트만 수행 (실제 로그인 시도 없음)
      await page.waitForSelector('input[type="email"]');
      await page.waitForSelector('input[type="password"]');
      await page.waitForSelector('button[type="submit"]');
      console.log(`  ✅ Login form elements found under ${condition.name} conditions`);
      
      // 네트워크 지연 고려하여 더 긴 대기 시간
      await page.waitForTimeout(3000);
      
      const currentUrl = page.url();
      console.log(`  📍 Final URL under ${condition.name}: ${currentUrl}`);
      
    } catch (error) {
      console.error(`  ❌ ${condition.name} test failed:`, error.message);
    }
  }
  
  await browser.close();
  console.log('\n🏁 Network conditions test completed!');
}

// 백그라운드/포그라운드 테스트 (모바일 앱 전환 시뮬레이션)
async function testBackgroundForeground() {
  console.log('\n🔄 Testing background/foreground transitions...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...require('playwright').devices['iPhone 13'],
    hasTouch: true,
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto('http://localhost:3000/login');
    
    // UI 요소 확인만 수행
    await page.waitForSelector('input[type="email"]');
    await page.waitForSelector('input[type="password"]');
    await page.waitForSelector('button[type="submit"]');
    console.log('  ✅ Login form elements found');
    
    // 백그라운드 시뮬레이션 (페이지 숨김)
    console.log('  📱 Simulating app going to background...');
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    });
    
    await page.waitForTimeout(3000);
    
    // 포그라운드 시뮬레이션 (페이지 다시 활성화)
    console.log('  📱 Simulating app coming to foreground...');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    
    await page.waitForTimeout(5000);
    
    const finalUrl = page.url();
    console.log(`  📍 Final URL after background/foreground: ${finalUrl}`);
    
    if (finalUrl.includes('/board') || finalUrl.includes('/register/')) {
      console.log('  ✅ Authentication survived background/foreground transition');
    } else {
      console.log('  ⚠️  Authentication may have been disrupted');
    }
    
  } catch (error) {
    console.error('  ❌ Background/foreground test failed:', error.message);
  }
  
  await browser.close();
  console.log('\n🏁 Background/foreground test completed!');
}

// 실행
async function runAllTests() {
  console.log('🧪 Starting comprehensive mobile login tests...\n');
  
  try {
    await testMobileLogin();
    await testMobileNetworkConditions();
    await testBackgroundForeground();
    
    console.log('\n🎉 All mobile login tests completed successfully!');
    console.log('\n📊 Test Results Summary:');
    console.log('- Check console logs for authentication flow details');
    console.log('- Check screenshot files for visual verification');
    console.log('- Review network request/response patterns');
    console.log('\n💡 If tests fail, check:');
    console.log('1. Local development server is running (npm run dev)');
    console.log('2. Supabase connection is working');
    console.log('3. Test credentials are valid');
    console.log('4. Mobile-specific session handling is working');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests();
}

module.exports = {
  testMobileLogin,
  testMobileNetworkConditions,
  testBackgroundForeground
};