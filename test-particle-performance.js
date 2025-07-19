/**
 * 파티클 시스템 성능 테스트 스크립트
 * 다양한 디바이스 환경에서 파티클 시스템의 성능을 측정합니다.
 */

const { chromium, firefox, webkit } = require('playwright');

// 테스트할 디바이스 설정
const deviceConfigs = [
  // 데스크톱 환경
  {
    name: 'Desktop Chrome High-end',
    browser: 'chromium',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    cpu: 'high',
    memory: 'high'
  },
  {
    name: 'Desktop Chrome Mid-range',
    browser: 'chromium',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    cpu: 'medium',
    memory: 'medium'
  },
  // 모바일 환경
  {
    name: 'iPhone 12 Pro',
    browser: 'webkit',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X)',
    cpu: 'medium',
    memory: 'medium'
  },
  {
    name: 'Samsung Galaxy S21',
    browser: 'chromium',
    viewport: { width: 384, height: 854 },
    deviceScaleFactor: 2.75,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B)',
    cpu: 'medium',
    memory: 'medium'
  },
  {
    name: 'iPad Pro',
    browser: 'webkit',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_7_1 like Mac OS X)',
    cpu: 'high',
    memory: 'high'
  },
  // 저사양 환경
  {
    name: 'Low-end Android',
    browser: 'chromium',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 9; SM-A102U)',
    cpu: 'low',
    memory: 'low'
  }
];

// 테스트할 페이지와 파티클 시스템
const testPages = [
  {
    url: 'http://localhost:3003',
    name: 'Home Page',
    hasParticles: true,
    particleTypes: ['AdaptiveParticles']
  },
  {
    url: 'http://localhost:3003/about',
    name: 'About Page',
    hasParticles: true,
    particleTypes: ['LiquidMetalParticles', 'WebGLParticles']
  },
  {
    url: 'http://localhost:3003/artists',
    name: 'Artists Page',
    hasParticles: false,
    particleTypes: []
  }
];

// 성능 메트릭 수집 함수
async function collectPerformanceMetrics(page) {
  return await page.evaluate(() => {
    const performance = window.performance;
    const memory = performance.memory;
    
    // WebGL 컨텍스트 정보
    const getWebGLInfo = () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      
      if (!gl) {
        return { supported: false };
      }
      
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      
      return {
        supported: true,
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
        version: gl.getParameter(gl.VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)
      };
    };
    
    // 파티클 시스템 상태 확인
    const getParticleSystemStatus = () => {
      const particleElements = document.querySelectorAll('[data-particle-system]');
      const systems = [];
      
      particleElements.forEach(element => {
        const systemType = element.getAttribute('data-particle-system');
        const canvas = element.querySelector('canvas');
        
        systems.push({
          type: systemType,
          active: !element.style.display || element.style.display !== 'none',
          hasCanvas: !!canvas,
          canvasSize: canvas ? {
            width: canvas.width,
            height: canvas.height
          } : null
        });
      });
      
      return systems;
    };
    
    return {
      navigation: performance.getEntriesByType('navigation')[0],
      memory: memory ? {
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit
      } : null,
      webgl: getWebGLInfo(),
      particleSystems: getParticleSystemStatus()
    };
  });
}

// FPS 측정 함수 (별도)
async function measureFPS(page, duration = 1000) {
  return await page.evaluate((testDuration) => {
    return new Promise((resolve) => {
      let frameCount = 0;
      const startTime = performance.now();
      
      const countFrames = () => {
        frameCount++;
        const elapsed = performance.now() - startTime;
        
        if (elapsed >= testDuration) {
          const fps = (frameCount * 1000) / elapsed;
          resolve(Math.round(fps));
        } else {
          requestAnimationFrame(countFrames);
        }
      };
      
      requestAnimationFrame(countFrames);
    });
  }, duration);
}

// CPU 집약적 작업으로 성능 부하 테스트
async function performLoadTest(page, duration = 5000) {
  console.log(`  🔄 Performing load test for ${duration}ms...`);
  
  return await page.evaluate((testDuration) => {
    return new Promise((resolve) => {
      const startTime = performance.now();
      let frameCount = 0;
      const fpsSamples = [];
      
      const testLoop = () => {
        const currentTime = performance.now();
        const elapsed = currentTime - startTime;
        
        // FPS 측정
        frameCount++;
        if (frameCount % 60 === 0) { // 매 60프레임마다 FPS 기록
          const fps = 60000 / (currentTime - lastFrameTime);
          fpsSamples.push(fps);
        }
        var lastFrameTime = currentTime;
        
        // CPU 집약적 작업 시뮬레이션
        const array = new Array(1000).fill(0).map((_, i) => Math.sin(i));
        array.sort();
        
        if (elapsed < testDuration) {
          requestAnimationFrame(testLoop);
        } else {
          const avgFPS = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
          const minFPS = Math.min(...fpsSamples);
          const maxFPS = Math.max(...fpsSamples);
          
          resolve({
            avgFPS: avgFPS || 0,
            minFPS: minFPS || 0,
            maxFPS: maxFPS || 0,
            frameCount,
            duration: elapsed,
            samples: fpsSamples.length
          });
        }
      };
      
      requestAnimationFrame(testLoop);
    });
  }, duration);
}

// 메모리 누수 테스트
async function checkMemoryLeaks(page) {
  console.log('  🧠 Checking for memory leaks...');
  
  const initialMemory = await page.evaluate(() => {
    return performance.memory ? performance.memory.usedJSHeapSize : null;
  });
  
  // 페이지 새로고침으로 파티클 시스템 재초기화
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  const finalMemory = await page.evaluate(() => {
    return performance.memory ? performance.memory.usedJSHeapSize : null;
  });
  
  if (initialMemory && finalMemory) {
    const memoryDiff = finalMemory - initialMemory;
    const leakPercentage = (memoryDiff / initialMemory) * 100;
    
    return {
      initial: initialMemory,
      final: finalMemory,
      difference: memoryDiff,
      leakPercentage,
      hasLeak: leakPercentage > 10 // 10% 이상 증가시 누수로 판단
    };
  }
  
  return null;
}

// 단일 디바이스 테스트 실행
async function testDevice(deviceConfig) {
  console.log(`\n🔧 Testing ${deviceConfig.name}...`);
  
  const browserType = {
    'chromium': chromium,
    'firefox': firefox,
    'webkit': webkit
  }[deviceConfig.browser];
  
  const browser = await browserType.launch({
    headless: true,
    args: [
      '--disable-web-security',
      '--disable-features=TranslateUI',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // GPU 가속 설정
      '--enable-gpu',
      '--enable-webgl',
      // 메모리 제한 (저사양 디바이스 시뮬레이션)
      deviceConfig.memory === 'low' ? '--max_old_space_size=512' : '',
      // CPU 제한 (저사양 디바이스 시뮬레이션)
      deviceConfig.cpu === 'low' ? '--max-semi-space-size=1' : ''
    ].filter(Boolean)
  });
  
  const context = await browser.newContext({
    viewport: deviceConfig.viewport,
    deviceScaleFactor: deviceConfig.deviceScaleFactor,
    userAgent: deviceConfig.userAgent
  });
  
  const page = await context.newPage();
  
  const deviceResults = {
    device: deviceConfig.name,
    pages: {}
  };
  
  // 각 페이지 테스트
  for (const testPage of testPages) {
    console.log(`  📄 Testing ${testPage.name}...`);
    
    try {
      // 페이지 로드
      await page.goto(testPage.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000); // 파티클 시스템 초기화 대기
      
      // 기본 성능 메트릭 수집
      const metrics = await collectPerformanceMetrics(page);
      
      // FPS 측정
      const fps = await measureFPS(page, 1000);
      
      // 로드 테스트
      const loadTest = await performLoadTest(page, 3000);
      
      // 메모리 누수 검사
      const memoryLeak = await checkMemoryLeaks(page);
      
      deviceResults.pages[testPage.name] = {
        url: testPage.url,
        loadTime: metrics.navigation.loadEventEnd - metrics.navigation.fetchStart,
        firstContentfulPaint: metrics.navigation.domContentLoadedEventEnd - metrics.navigation.fetchStart,
        memory: metrics.memory,
        webgl: metrics.webgl,
        particleSystems: metrics.particleSystems,
        fps: {
          idle: fps,
          underLoad: loadTest
        },
        memoryLeak,
        performance: {
          score: calculatePerformanceScore(fps, loadTest, metrics.memory),
          recommendation: getPerformanceRecommendation(fps, loadTest, deviceConfig)
        }
      };
      
      console.log(`    ✅ FPS: ${fps}, Load Avg: ${loadTest.avgFPS.toFixed(1)}`);
      
    } catch (error) {
      console.error(`    ❌ Error testing ${testPage.name}:`, error.message);
      deviceResults.pages[testPage.name] = {
        error: error.message
      };
    }
  }
  
  await browser.close();
  return deviceResults;
}

// 성능 점수 계산
function calculatePerformanceScore(idleFPS, loadTest, memory) {
  let score = 100;
  
  // FPS 기반 점수 차감
  if (idleFPS < 30) score -= 30;
  else if (idleFPS < 45) score -= 15;
  else if (idleFPS < 55) score -= 5;
  
  // 로드 테스트 기반 점수 차감
  if (loadTest.avgFPS < 20) score -= 25;
  else if (loadTest.avgFPS < 30) score -= 15;
  else if (loadTest.avgFPS < 45) score -= 10;
  
  // 메모리 사용량 기반 점수 차감
  if (memory && memory.used > 100 * 1024 * 1024) score -= 20; // 100MB 초과
  else if (memory && memory.used > 50 * 1024 * 1024) score -= 10; // 50MB 초과
  
  return Math.max(0, score);
}

// 성능 개선 권장사항
function getPerformanceRecommendation(idleFPS, loadTest, deviceConfig) {
  const recommendations = [];
  
  if (idleFPS < 30) {
    recommendations.push('파티클 시스템을 CSS 기반으로 변경하거나 비활성화');
  } else if (idleFPS < 45) {
    recommendations.push('파티클 수량 감소 또는 OptimizedLiquidMetalParticles 사용');
  }
  
  if (loadTest.avgFPS < 20) {
    recommendations.push('정적 배경 이미지로 대체');
  } else if (loadTest.avgFPS < 30) {
    recommendations.push('간단한 CSS 애니메이션으로 대체');
  }
  
  if (deviceConfig.cpu === 'low') {
    recommendations.push('저사양 디바이스 최적화 모드 적용');
  }
  
  if (deviceConfig.memory === 'low') {
    recommendations.push('메모리 사용량 최적화 필요');
  }
  
  return recommendations;
}

// 테스트 결과 요약
function generateSummaryReport(results) {
  console.log('\n📊 PERFORMANCE TEST SUMMARY');
  console.log('='.repeat(50));
  
  const summary = {
    totalDevices: results.length,
    averageScores: {},
    recommendations: new Set(),
    criticalIssues: []
  };
  
  results.forEach(deviceResult => {
    console.log(`\n📱 ${deviceResult.device}`);
    
    Object.entries(deviceResult.pages).forEach(([pageName, pageData]) => {
      if (pageData.error) {
        console.log(`  ❌ ${pageName}: ERROR - ${pageData.error}`);
        summary.criticalIssues.push(`${deviceResult.device} - ${pageName}: ${pageData.error}`);
        return;
      }
      
      const score = pageData.performance.score;
      const idleFPS = pageData.fps.idle;
      const loadFPS = pageData.fps.underLoad.avgFPS;
      
      if (!summary.averageScores[pageName]) {
        summary.averageScores[pageName] = [];
      }
      summary.averageScores[pageName].push(score);
      
      console.log(`  📄 ${pageName}:`);
      console.log(`    Performance Score: ${score}/100`);
      console.log(`    FPS (Idle/Load): ${idleFPS}/${loadFPS.toFixed(1)}`);
      console.log(`    WebGL Support: ${pageData.webgl.supported ? '✅' : '❌'}`);
      console.log(`    Particle Systems: ${pageData.particleSystems.length}`);
      
      if (pageData.memoryLeak && pageData.memoryLeak.hasLeak) {
        console.log(`    ⚠️  Memory Leak Detected: ${pageData.memoryLeak.leakPercentage.toFixed(1)}%`);
        summary.criticalIssues.push(`${deviceResult.device} - ${pageName}: Memory leak detected`);
      }
      
      if (score < 70) {
        console.log(`    ⚠️  Low Performance Score`);
      }
      
      pageData.performance.recommendation.forEach(rec => {
        summary.recommendations.add(rec);
      });
    });
  });
  
  // 전체 요약
  console.log('\n🎯 OVERALL SUMMARY');
  console.log('-'.repeat(30));
  
  Object.entries(summary.averageScores).forEach(([pageName, scores]) => {
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`${pageName}: Average Score ${avgScore.toFixed(1)}/100`);
  });
  
  if (summary.criticalIssues.length > 0) {
    console.log('\n🚨 CRITICAL ISSUES:');
    summary.criticalIssues.forEach(issue => console.log(`  - ${issue}`));
  }
  
  if (summary.recommendations.size > 0) {
    console.log('\n💡 RECOMMENDATIONS:');
    Array.from(summary.recommendations).forEach(rec => console.log(`  - ${rec}`));
  }
  
  return summary;
}

// 메인 테스트 실행 함수
async function runParticlePerformanceTests() {
  console.log('🚀 Starting Particle System Performance Tests...');
  console.log(`Testing ${deviceConfigs.length} device configurations across ${testPages.length} pages`);
  
  const results = [];
  
  for (const deviceConfig of deviceConfigs) {
    try {
      const deviceResult = await testDevice(deviceConfig);
      results.push(deviceResult);
    } catch (error) {
      console.error(`❌ Failed to test ${deviceConfig.name}:`, error);
      results.push({
        device: deviceConfig.name,
        error: error.message
      });
    }
  }
  
  // 결과 요약 생성
  const summary = generateSummaryReport(results);
  
  // 결과를 파일로 저장
  const fs = require('fs');
  const reportData = {
    timestamp: new Date().toISOString(),
    summary,
    detailed: results
  };
  
  fs.writeFileSync(
    'particle-performance-report.json',
    JSON.stringify(reportData, null, 2)
  );
  
  console.log('\n✅ Performance test completed!');
  console.log('📄 Detailed report saved to: particle-performance-report.json');
  
  return summary;
}

// 스크립트 실행
if (require.main === module) {
  runParticlePerformanceTests().catch(console.error);
}

module.exports = {
  runParticlePerformanceTests,
  testDevice,
  deviceConfigs,
  testPages
};