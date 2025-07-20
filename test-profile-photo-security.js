/**
 * 프로필 사진 시스템 보안 및 성능 테스트
 * API 보안, 파일 검증, 성능 최적화 등 검증
 */

const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')

console.log('🔒 프로필 사진 시스템 보안 및 성능 테스트 시작...\n')

// 테스트 설정
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  maxFileSize: 5 * 1024 * 1024, // 5MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxResponseTime: 5000, // 5초
  timeouts: {
    upload: 30000, // 30초
    delete: 10000, // 10초
    fetch: 5000    // 5초
  }
}

/**
 * 테스트용 파일 생성기
 */
function createTestFile(type, size) {
  const buffer = Buffer.alloc(size)
  
  switch (type) {
    case 'jpeg':
      // 최소한의 JPEG 헤더
      buffer.writeUInt16BE(0xFFD8, 0) // SOI marker
      buffer.writeUInt16BE(0xFFE0, 2) // APP0 marker
      return buffer
    
    case 'png':
      // PNG 시그니처
      buffer.write('\x89PNG\r\n\x1a\n', 0, 'binary')
      return buffer
    
    case 'malicious':
      // 악성 파일 시뮬레이션 (실제로는 무해함)
      buffer.write('<script>alert("XSS")</script>', 0)
      return buffer
    
    case 'oversized':
      // 허용 크기 초과 파일
      return Buffer.alloc(size || TEST_CONFIG.maxFileSize + 1024)
    
    default:
      return buffer
  }
}

/**
 * 서버 상태 확인
 */
async function checkServerStatus() {
  try {
    const response = await fetch(`${TEST_CONFIG.baseUrl}/`, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    })
    return response.ok
  } catch (error) {
    return false
  }
}

/**
 * API 보안 테스트
 */
async function testAPISecurity() {
  console.log('🛡️ API 보안 테스트...')
  
  const serverRunning = await checkServerStatus()
  if (!serverRunning) {
    console.log('⚠️ 개발 서버가 실행되지 않아 API 테스트를 건너뜀 (npm run dev로 서버 시작)')
    return [{
      name: 'API 서버 상태 확인',
      passed: false,
      error: '개발 서버가 실행되지 않음',
      status: '⚠️'
    }]
  }
  
  const securityTests = [
    {
      name: '인증되지 않은 요청 차단',
      test: async () => {
        const response = await fetch(`${TEST_CONFIG.baseUrl}/api/mypage/artist/photo`, {
          method: 'PUT',
          body: new FormData()
        })
        return response.status === 401
      }
    },
    {
      name: '잘못된 HTTP 메소드 차단',
      test: async () => {
        const response = await fetch(`${TEST_CONFIG.baseUrl}/api/mypage/artist/photo`, {
          method: 'PATCH' // 지원하지 않는 메소드
        })
        return response.status === 405 || response.status === 404
      }
    },
    {
      name: 'Content-Type 검증',
      test: async () => {
        const response = await fetch(`${TEST_CONFIG.baseUrl}/api/mypage/artist/photo`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json' // 잘못된 Content-Type
          },
          body: JSON.stringify({})
        })
        return response.status >= 400
      }
    },
    {
      name: 'CORS 헤더 확인',
      test: async () => {
        const response = await fetch(`${TEST_CONFIG.baseUrl}/api/mypage/artist/photo`, {
          method: 'OPTIONS'
        })
        const corsHeader = response.headers.get('Access-Control-Allow-Origin')
        return corsHeader !== '*' // 와일드카드 CORS 금지
      }
    }
  ]

  const results = []
  for (const test of securityTests) {
    try {
      const startTime = performance.now()
      const passed = await test.test()
      const duration = performance.now() - startTime
      
      results.push({
        name: test.name,
        passed,
        duration: Math.round(duration),
        status: passed ? '✅' : '❌'
      })
      
      console.log(`  ${passed ? '✅' : '❌'} ${test.name} (${Math.round(duration)}ms)`)
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        error: error.message,
        status: '❌'
      })
      console.log(`  ❌ ${test.name} - 오류: ${error.message}`)
    }
  }
  
  return results
}

/**
 * 파일 검증 테스트
 */
async function testFileValidation() {
  console.log('\n📋 파일 검증 테스트...')
  
  const validationTests = [
    {
      name: '허용된 파일 타입 (JPEG)',
      file: {
        type: 'image/jpeg',
        content: createTestFile('jpeg', 1024)
      },
      shouldPass: true
    },
    {
      name: '허용된 파일 타입 (PNG)',
      file: {
        type: 'image/png',
        content: createTestFile('png', 1024)
      },
      shouldPass: true
    },
    {
      name: '허용되지 않은 파일 타입 (PDF)',
      file: {
        type: 'application/pdf',
        content: createTestFile('malicious', 1024)
      },
      shouldPass: false
    },
    {
      name: '허용되지 않은 파일 타입 (JS)',
      file: {
        type: 'application/javascript',
        content: createTestFile('malicious', 1024)
      },
      shouldPass: false
    },
    {
      name: '파일 크기 제한 (초과)',
      file: {
        type: 'image/jpeg',
        content: createTestFile('oversized', TEST_CONFIG.maxFileSize + 1024)
      },
      shouldPass: false
    },
    {
      name: '빈 파일',
      file: {
        type: 'image/jpeg',
        content: Buffer.alloc(0)
      },
      shouldPass: false
    }
  ]

  const results = []
  for (const test of validationTests) {
    try {
      // 클라이언트 사이드 검증 시뮬레이션
      const isValidType = TEST_CONFIG.allowedTypes.includes(test.file.type)
      const isValidSize = test.file.content.length > 0 && test.file.content.length <= TEST_CONFIG.maxFileSize
      const clientValidation = isValidType && isValidSize
      
      const passed = test.shouldPass ? clientValidation : !clientValidation
      
      results.push({
        name: test.name,
        passed,
        expectedResult: test.shouldPass ? 'PASS' : 'FAIL',
        actualResult: clientValidation ? 'PASS' : 'FAIL',
        fileSize: test.file.content.length,
        status: passed ? '✅' : '❌'
      })
      
      console.log(`  ${passed ? '✅' : '❌'} ${test.name} (${test.file.content.length} bytes)`)
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        error: error.message,
        status: '❌'
      })
      console.log(`  ❌ ${test.name} - 오류: ${error.message}`)
    }
  }
  
  return results
}

/**
 * 성능 테스트
 */
async function testPerformance() {
  console.log('\n⚡ 성능 테스트...')
  
  const serverRunning = await checkServerStatus()
  if (!serverRunning) {
    console.log('⚠️ 개발 서버가 실행되지 않아 성능 테스트를 건너뜀')
    return [{
      name: '성능 서버 상태 확인',
      passed: false,
      error: '개발 서버가 실행되지 않음',
      status: '⚠️'
    }]
  }
  
  const performanceTests = [
    {
      name: 'API 응답 시간 (GET)',
      test: async () => {
        const startTime = performance.now()
        try {
          const response = await fetch(`${TEST_CONFIG.baseUrl}/api/mypage/artist/photo`)
          const duration = performance.now() - startTime
          return {
            duration,
            passed: duration < TEST_CONFIG.maxResponseTime,
            status: response.status
          }
        } catch (error) {
          return {
            duration: performance.now() - startTime,
            passed: false,
            error: error.message
          }
        }
      }
    },
    {
      name: 'API 응답 시간 (미디어 목록)',
      test: async () => {
        const startTime = performance.now()
        try {
          const response = await fetch(`${TEST_CONFIG.baseUrl}/api/media/upload`)
          const duration = performance.now() - startTime
          return {
            duration,
            passed: duration < TEST_CONFIG.maxResponseTime,
            status: response.status
          }
        } catch (error) {
          return {
            duration: performance.now() - startTime,
            passed: false,
            error: error.message
          }
        }
      }
    },
    {
      name: '이미지 로딩 성능',
      test: async () => {
        const startTime = performance.now()
        try {
          const response = await fetch(`${TEST_CONFIG.baseUrl}/images/artists/default-artist.png`)
          const duration = performance.now() - startTime
          return {
            duration,
            passed: duration < TEST_CONFIG.maxResponseTime && response.ok,
            status: response.status,
            size: response.headers.get('content-length')
          }
        } catch (error) {
          return {
            duration: performance.now() - startTime,
            passed: false,
            error: error.message
          }
        }
      }
    }
  ]

  const results = []
  for (const test of performanceTests) {
    try {
      const result = await test.test()
      
      results.push({
        name: test.name,
        ...result,
        status: result.passed ? '✅' : '❌'
      })
      
      console.log(`  ${result.passed ? '✅' : '❌'} ${test.name} (${Math.round(result.duration)}ms)`)
      if (result.size) {
        console.log(`    📦 크기: ${result.size} bytes`)
      }
      if (result.error) {
        console.log(`    ⚠️ 오류: ${result.error}`)
      }
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        error: error.message,
        status: '❌'
      })
      console.log(`  ❌ ${test.name} - 오류: ${error.message}`)
    }
  }
  
  return results
}

/**
 * 메모리 및 리소스 테스트
 */
async function testResourceUsage() {
  console.log('\n💾 리소스 사용량 테스트...')
  
  const initialMemory = process.memoryUsage()
  console.log(`  📊 초기 메모리 사용량: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)
  
  // 대용량 파일 처리 시뮬레이션
  const largeFiles = []
  for (let i = 0; i < 10; i++) {
    largeFiles.push(createTestFile('jpeg', 1024 * 1024)) // 1MB씩 10개
  }
  
  const peakMemory = process.memoryUsage()
  console.log(`  📊 피크 메모리 사용량: ${Math.round(peakMemory.heapUsed / 1024 / 1024)}MB`)
  
  // 메모리 해제
  largeFiles.length = 0
  
  // 가비지 컬렉션 강제 실행 (가능한 경우)
  if (global.gc) {
    global.gc()
  }
  
  const finalMemory = process.memoryUsage()
  console.log(`  📊 최종 메모리 사용량: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`)
  
  const memoryLeak = finalMemory.heapUsed > initialMemory.heapUsed * 1.5
  console.log(`  ${memoryLeak ? '❌' : '✅'} 메모리 누수 검사 ${memoryLeak ? '실패' : '통과'}`)
  
  return {
    initialMemoryMB: Math.round(initialMemory.heapUsed / 1024 / 1024),
    peakMemoryMB: Math.round(peakMemory.heapUsed / 1024 / 1024),
    finalMemoryMB: Math.round(finalMemory.heapUsed / 1024 / 1024),
    memoryLeakDetected: memoryLeak,
    passed: !memoryLeak
  }
}

/**
 * 종합 보안 및 성능 테스트 실행
 */
async function runSecurityAndPerformanceTests() {
  console.log('🔒 프로필 사진 시스템 보안 및 성능 테스트 시작...\n')
  
  const results = {
    security: [],
    validation: [],
    performance: [],
    resources: null,
    startTime: new Date(),
    summary: {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      duration: 0
    }
  }
  
  const overallStartTime = performance.now()
  
  try {
    // 1. API 보안 테스트
    results.security = await testAPISecurity()
    
    // 2. 파일 검증 테스트
    results.validation = await testFileValidation()
    
    // 3. 성능 테스트
    results.performance = await testPerformance()
    
    // 4. 리소스 사용량 테스트
    results.resources = await testResourceUsage()
    
    // 결과 집계
    const allTests = [
      ...results.security,
      ...results.validation, 
      ...results.performance
    ]
    
    results.summary.totalTests = allTests.length
    results.summary.passedTests = allTests.filter(t => t.passed).length
    results.summary.failedTests = allTests.filter(t => !t.passed).length
    results.summary.duration = Math.round(performance.now() - overallStartTime)
    
    // 결과 출력
    console.log('\n📊 테스트 결과 요약:')
    console.log(`  📈 총 테스트: ${results.summary.totalTests}개`)
    console.log(`  ✅ 성공: ${results.summary.passedTests}개`)
    console.log(`  ❌ 실패: ${results.summary.failedTests}개`)
    console.log(`  ⏱️ 소요 시간: ${results.summary.duration}ms`)
    console.log(`  📊 성공률: ${Math.round((results.summary.passedTests / results.summary.totalTests) * 100)}%`)
    
    // 상세 실패 내역
    if (results.summary.failedTests > 0) {
      console.log('\n❌ 실패한 테스트:')
      allTests.filter(t => !t.passed).forEach(test => {
        console.log(`  - ${test.name}`)
        if (test.error) {
          console.log(`    오류: ${test.error}`)
        }
      })
    }
    
    // 성능 이슈 경고
    const slowTests = allTests.filter(t => t.duration && t.duration > 2000)
    if (slowTests.length > 0) {
      console.log('\n⚠️ 성능 주의 (2초 이상):')
      slowTests.forEach(test => {
        console.log(`  - ${test.name}: ${test.duration}ms`)
      })
    }
    
    // 보안 권고사항
    console.log('\n🛡️ 보안 권고사항:')
    console.log('  - 파일 업로드 시 서버 사이드 검증 필수')
    console.log('  - 업로드된 파일의 실행 권한 제거')
    console.log('  - CDN 또는 별도 스토리지 사용 권장')
    console.log('  - 이미지 리사이징 및 메타데이터 제거')
    console.log('  - 업로드 속도 제한 구현')
    
    // 성능 최적화 권고사항
    console.log('\n⚡ 성능 최적화 권고사항:')
    console.log('  - 이미지 압축 및 WebP 포맷 사용')
    console.log('  - 프로그레시브 로딩 구현')
    console.log('  - CDN 캐싱 활용')
    console.log('  - 썸네일 생성 및 다중 해상도 지원')
    console.log('  - 지연 로딩(Lazy Loading) 구현')
    
    return results
    
  } catch (error) {
    console.error('❌ 보안 및 성능 테스트 실행 중 오류:', error.message)
    throw error
  }
}

// 테스트 실행
if (require.main === module) {
  runSecurityAndPerformanceTests()
    .then((results) => {
      const success = results.summary.failedTests === 0
      console.log(`\n${success ? '✨' : '💥'} 보안 및 성능 테스트 ${success ? '완료' : '실패'}!`)
      
      // 결과를 파일로 저장
      const reportPath = path.join(__dirname, 'test-reports', 'security-performance-report.json')
      const reportDir = path.dirname(reportPath)
      
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true })
      }
      
      fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
      console.log(`📄 상세 리포트 저장됨: ${reportPath}`)
      
      process.exit(success ? 0 : 1)
    })
    .catch((error) => {
      console.error('\n💥 테스트 실행 실패:', error.message)
      process.exit(1)
    })
}

module.exports = { 
  runSecurityAndPerformanceTests,
  createTestFile,
  TEST_CONFIG
}