// 웹사이트 상태 체크 스크립트
const http = require('http');
const https = require('https');

function testEndpoint(url, description) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`✅ ${description}: ${res.statusCode} (${data.length} bytes)`);
        resolve({ status: res.statusCode, size: data.length, data });
      });
    });
    
    req.on('error', (err) => {
      console.log(`❌ ${description}: Error - ${err.message}`);
      resolve({ status: 'error', error: err.message });
    });
    
    req.setTimeout(10000, () => {
      console.log(`⏰ ${description}: Timeout`);
      req.abort();
      resolve({ status: 'timeout' });
    });
  });
}

async function runTests() {
  console.log('🚀 경기아트콜렉티브 웹사이트 상태 체크\n');
  
  const tests = [
    ['http://localhost:3000', '홈페이지'],
    ['http://localhost:3000/about', '소개 페이지'],
    ['http://localhost:3000/artists', '아티스트 페이지'],
    ['http://localhost:3000/artists/simon-dm', 'Simon DM 프로필'],
    ['http://localhost:3000/artists/choi-hee-chul', '최희철 프로필'],
    ['http://localhost:3000/archive', '아카이브 페이지'],
    ['http://localhost:3000/connect', '연락처 페이지'],
    ['http://localhost:3000/images/artists/simon-dm.png', 'Simon DM 이미지'],
    ['http://localhost:3000/images/logo/gac_logo.png', '로고 이미지'],
  ];
  
  for (const [url, description] of tests) {
    await testEndpoint(url, description);
  }
  
  // 홈페이지 이미지 태그 확인
  console.log('\n🔍 홈페이지 이미지 태그 분석:');
  const homeResult = await testEndpoint('http://localhost:3000', '홈페이지 데이터');
  if (homeResult.data) {
    const simonImageCount = (homeResult.data.match(/simon-dm\.png/g) || []).length;
    const imageTagCount = (homeResult.data.match(/<img[^>]*src="[^"]*simon-dm\.png"[^>]*>/g) || []).length;
    
    console.log(`   - Simon DM 이미지 참조: ${simonImageCount}회`);
    console.log(`   - IMG 태그: ${imageTagCount}개`);
    
    if (simonImageCount >= 2 && imageTagCount >= 2) {
      console.log('   ✅ 이미지가 정상적으로 렌더링될 준비가 완료되었습니다!');
    } else {
      console.log('   ⚠️ 이미지 태그가 예상보다 적습니다.');
    }
  }
  
  console.log('\n✨ 테스트 완료!');
}

runTests().catch(console.error);
