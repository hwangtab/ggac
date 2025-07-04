const { chromium } = require('playwright');

async function testImageLoading() {
  console.log('🚀 웹사이트 이미지 로딩 테스트 시작...');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // 로컬 개발 서버나 배포된 사이트 테스트
    const url = 'https://ggac.kr'; // 또는 'http://localhost:3000'
    console.log(`📱 접속 중: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // 아티스트 페이지로 이동
    console.log('👥 아티스트 페이지로 이동...');
    await page.click('a[href="/artists"]');
    await page.waitForLoadState('networkidle');
    
    // 장현호와 ANAZAO 이미지 체크
    console.log('🖼️ 문제가 있던 아티스트 이미지들 확인 중...');
    
    const images = await page.$$eval('img', imgs => 
      imgs.map(img => ({
        src: img.src,
        alt: img.alt,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete
      })).filter(img => 
        img.alt.includes('장현호') || img.alt.includes('ANAZAO')
      )
    );
    
    console.log('\n📊 이미지 로딩 결과:');
    images.forEach(img => {
      const status = img.complete && img.naturalWidth > 0 ? '✅ 성공' : '❌ 실패';
      console.log(`${status} ${img.alt}`);
      console.log(`   - URL: ${img.src}`);
      console.log(`   - 크기: ${img.naturalWidth}x${img.naturalHeight}`);
      console.log('');
    });
    
    // 스크린샷 저장
    await page.screenshot({ 
      path: 'artists-page-test.png', 
      fullPage: true 
    });
    console.log('📸 스크린샷 저장: artists-page-test.png');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
  } finally {
    await browser.close();
    console.log('🏁 테스트 완료');
  }
}

testImageLoading();