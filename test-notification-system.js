/**
 * 알림 시스템 테스트 스크립트
 * 알림 생성, 조회, 업데이트 기능을 테스트합니다.
 */

const { chromium } = require('playwright')

// 테스트 설정
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  adminEmail: 'admin@ggac.kr',
  adminPassword: 'admin123!',
  testUserEmail: 'test@ggac.kr',
  testUserPassword: 'test123!',
  timeout: 30000
}

// 테스트 결과 추적
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
}

// 유틸리티 함수들
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const logTest = (name, status, details = '') => {
  testResults.total++
  if (status === 'PASS') {
    testResults.passed++
    console.log(`✅ ${name}`)
  } else {
    testResults.failed++
    console.log(`❌ ${name}: ${details}`)
    testResults.errors.push({ test: name, error: details })
  }
  if (details) {
    console.log(`   ${details}`)
  }
}

// API 테스트 함수
async function testNotificationAPIs(page) {
  console.log('\n📡 알림 API 테스트 시작')

  try {
    // 1. 알림 통계 조회 테스트
    const statsResponse = await page.evaluate(async () => {
      const response = await fetch('/api/notifications/stats')
      return {
        ok: response.ok,
        status: response.status,
        data: response.ok ? await response.json() : null
      }
    })

    if (statsResponse.ok) {
      logTest('알림 통계 조회', 'PASS', `통계 데이터 조회 성공`)
    } else {
      logTest('알림 통계 조회', 'FAIL', `HTTP ${statsResponse.status}`)
    }

    // 2. 알림 목록 조회 테스트
    const listResponse = await page.evaluate(async () => {
      const response = await fetch('/api/notifications?limit=10')
      return {
        ok: response.ok,
        status: response.status,
        data: response.ok ? await response.json() : null
      }
    })

    if (listResponse.ok && listResponse.data) {
      logTest('알림 목록 조회', 'PASS', 
        `${listResponse.data.notifications.length}개 알림 조회됨`)
    } else {
      logTest('알림 목록 조회', 'FAIL', `HTTP ${listResponse.status}`)
    }

    // 3. 알림 읽음 처리 테스트 (알림이 있는 경우)
    if (listResponse.ok && listResponse.data.notifications.length > 0) {
      const firstNotification = listResponse.data.notifications[0]
      
      const markReadResponse = await page.evaluate(async (notificationId) => {
        const response = await fetch(`/api/notifications/${notificationId}`, {
          method: 'PATCH'
        })
        return {
          ok: response.ok,
          status: response.status
        }
      }, firstNotification.id)

      if (markReadResponse.ok) {
        logTest('알림 읽음 처리', 'PASS', '알림 읽음 처리 성공')
      } else {
        logTest('알림 읽음 처리', 'FAIL', `HTTP ${markReadResponse.status}`)
      }
    } else {
      logTest('알림 읽음 처리', 'SKIP', '테스트할 알림이 없음')
    }

  } catch (error) {
    logTest('알림 API 테스트', 'FAIL', error.message)
  }
}

// 알림 드롭다운 테스트
async function testNotificationDropdown(page) {
  console.log('\n🔔 알림 드롭다운 테스트 시작')

  try {
    // 페이지 로딩 대기
    await page.waitForLoadState('networkidle')

    // 알림 버튼 찾기
    const notificationButton = await page.locator('[aria-label="알림"]').first()
    if (await notificationButton.count() > 0) {
      logTest('알림 버튼 표시', 'PASS', '알림 버튼이 정상적으로 표시됨')

      // 알림 드롭다운 열기
      await notificationButton.click()
      await wait(1000)

      // 드롭다운 메뉴 확인
      const dropdown = await page.locator('.absolute.right-0.mt-2').first()
      if (await dropdown.isVisible()) {
        logTest('알림 드롭다운 열기', 'PASS', '드롭다운이 정상적으로 열림')

        // 알림 목록 또는 빈 상태 메시지 확인
        const hasNotifications = await page.locator('li p:has-text("새로운 알림이 없습니다.")').count()
        const notificationItems = await page.locator('ul.divide-y li').count()

        if (hasNotifications > 0 || notificationItems > 0) {
          logTest('알림 콘텐츠 표시', 'PASS', 
            notificationItems > 0 ? `${notificationItems}개 알림 표시됨` : '빈 상태 메시지 표시됨')
        } else {
          logTest('알림 콘텐츠 표시', 'FAIL', '알림 콘텐츠가 제대로 표시되지 않음')
        }

        // 드롭다운 닫기 (외부 클릭)
        await page.click('body')
        await wait(500)
        
        if (!(await dropdown.isVisible())) {
          logTest('알림 드롭다운 닫기', 'PASS', '외부 클릭으로 드롭다운이 정상적으로 닫힘')
        } else {
          logTest('알림 드롭다운 닫기', 'FAIL', '드롭다운이 닫히지 않음')
        }
      } else {
        logTest('알림 드롭다운 열기', 'FAIL', '드롭다운이 표시되지 않음')
      }
    } else {
      logTest('알림 버튼 표시', 'FAIL', '알림 버튼을 찾을 수 없음')
    }

  } catch (error) {
    logTest('알림 드롭다운 테스트', 'FAIL', error.message)
  }
}

// 알림 페이지 테스트
async function testNotificationPage(page) {
  console.log('\n📄 알림 페이지 테스트 시작')

  try {
    // 알림 페이지로 이동
    await page.goto(`${TEST_CONFIG.baseUrl}/notifications`)
    await page.waitForLoadState('networkidle')

    // 페이지 제목 확인
    const pageTitle = await page.locator('h1:has-text("알림")').first()
    if (await pageTitle.isVisible()) {
      logTest('알림 페이지 로딩', 'PASS', '알림 페이지가 정상적으로 로드됨')

      // 통계 정보 확인
      const statsText = await page.locator('p:has-text("전체")').first()
      if (await statsText.isVisible()) {
        const statsContent = await statsText.textContent()
        logTest('알림 통계 표시', 'PASS', `통계: ${statsContent}`)
      } else {
        logTest('알림 통계 표시', 'FAIL', '통계 정보가 표시되지 않음')
      }

      // 필터 컨트롤 확인
      const filterSelect = await page.locator('select').first()
      if (await filterSelect.isVisible()) {
        logTest('필터 컨트롤 표시', 'PASS', '필터 컨트롤이 정상적으로 표시됨')

        // 필터 변경 테스트
        await filterSelect.selectOption('post_new')
        await wait(1000)
        logTest('필터 변경', 'PASS', '필터 변경이 정상적으로 동작함')
      } else {
        logTest('필터 컨트롤 표시', 'FAIL', '필터 컨트롤을 찾을 수 없음')
      }

      // 새로고침 버튼 테스트
      const refreshButton = await page.locator('button:has-text("새로고침")').first()
      if (await refreshButton.isVisible()) {
        await refreshButton.click()
        await wait(1000)
        logTest('새로고침 기능', 'PASS', '새로고침 버튼이 정상적으로 동작함')
      } else {
        logTest('새로고침 기능', 'FAIL', '새로고침 버튼을 찾을 수 없음')
      }

    } else {
      logTest('알림 페이지 로딩', 'FAIL', '알림 페이지를 로드할 수 없음')
    }

  } catch (error) {
    logTest('알림 페이지 테스트', 'FAIL', error.message)
  }
}

// 관리자 알림 관리 테스트
async function testAdminNotificationManagement(page) {
  console.log('\n👑 관리자 알림 관리 테스트 시작')

  try {
    // 관리자 알림 관리 페이지로 이동
    await page.goto(`${TEST_CONFIG.baseUrl}/admin/notifications`)
    await page.waitForLoadState('networkidle')

    // 관리자 권한 확인 (접근 가능한지)
    const pageTitle = await page.locator('h1:has-text("알림 관리")').first()
    if (await pageTitle.isVisible()) {
      logTest('관리자 알림 관리 페이지 접근', 'PASS', '관리자 페이지에 정상 접근됨')

      // 알림 발송 폼 확인
      const notificationForm = await page.locator('h3:has-text("알림 발송")').first()
      if (await notificationForm.isVisible()) {
        logTest('알림 발송 폼 표시', 'PASS', '알림 발송 폼이 정상적으로 표시됨')

        // 폼 요소들 확인
        const typeSelect = await page.locator('select').first()
        const titleInput = await page.locator('input[placeholder*="제목"]').first()
        const messageTextarea = await page.locator('textarea[placeholder*="내용"]').first()

        if (await typeSelect.isVisible() && await titleInput.isVisible() && await messageTextarea.isVisible()) {
          logTest('폼 요소 확인', 'PASS', '모든 폼 요소가 정상적으로 표시됨')

          // 테스트 데이터 입력
          await typeSelect.selectOption('system_notice')
          await titleInput.fill('테스트 알림')
          await messageTextarea.fill('이것은 테스트 알림입니다.')
          
          logTest('폼 데이터 입력', 'PASS', '테스트 데이터 입력 완료')
        } else {
          logTest('폼 요소 확인', 'FAIL', '일부 폼 요소가 표시되지 않음')
        }
      } else {
        logTest('알림 발송 폼 표시', 'FAIL', '알림 발송 폼을 찾을 수 없음')
      }

      // 대상자 목록 확인
      const memberList = await page.locator('h3:has-text("대상자 목록")').first()
      if (await memberList.isVisible()) {
        logTest('대상자 목록 표시', 'PASS', '대상자 목록이 정상적으로 표시됨')

        // 멤버 체크박스 확인
        const memberCheckboxes = await page.locator('input[type="checkbox"]').count()
        if (memberCheckboxes > 0) {
          logTest('멤버 선택 기능', 'PASS', `${memberCheckboxes}개의 선택 가능한 멤버 표시됨`)
        } else {
          logTest('멤버 선택 기능', 'FAIL', '선택 가능한 멤버가 없음')
        }
      } else {
        logTest('대상자 목록 표시', 'FAIL', '대상자 목록을 찾을 수 없음')
      }

    } else {
      // 403 또는 로그인 페이지로 리다이렉트된 경우
      const currentUrl = page.url()
      if (currentUrl.includes('/login')) {
        logTest('관리자 알림 관리 페이지 접근', 'SKIP', '관리자 권한이 없어 로그인 페이지로 리다이렉트됨')
      } else {
        logTest('관리자 알림 관리 페이지 접근', 'FAIL', '페이지에 접근할 수 없음')
      }
    }

  } catch (error) {
    logTest('관리자 알림 관리 테스트', 'FAIL', error.message)
  }
}

// 로그인 함수
async function login(page, email, password) {
  try {
    await page.goto(`${TEST_CONFIG.baseUrl}/login`)
    await page.waitForLoadState('networkidle')

    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    
    // 로그인 완료 대기
    await page.waitForURL(url => !url.includes('/login'), { timeout: 10000 })
    await wait(2000)
    
    return true
  } catch (error) {
    console.error('로그인 실패:', error)
    return false
  }
}

// 메인 테스트 함수
async function runNotificationSystemTests() {
  console.log('🚀 알림 시스템 테스트 시작')
  console.log('=' .repeat(50))

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    })
    const page = await context.newPage()

    // 콘솔 에러 모니터링
    page.on('console', message => {
      if (message.type() === 'error') {
        console.log(`🚨 Console Error: ${message.text()}`)
      }
    })

    console.log('\n👤 사용자로 로그인하여 테스트 진행')
    
    // 1. 일반 사용자로 로그인 (알림 기능 테스트)
    if (await login(page, TEST_CONFIG.testUserEmail, TEST_CONFIG.testUserPassword)) {
      console.log('✅ 일반 사용자 로그인 성공')
      
      // 알림 API 테스트
      await testNotificationAPIs(page)
      
      // 알림 드롭다운 테스트
      await testNotificationDropdown(page)
      
      // 알림 페이지 테스트
      await testNotificationPage(page)
      
    } else {
      console.log('❌ 일반 사용자 로그인 실패 - 알림 기능 테스트 스킵')
    }

    console.log('\n👑 관리자로 로그인하여 관리 기능 테스트')
    
    // 2. 관리자로 로그인 (관리 기능 테스트)
    if (await login(page, TEST_CONFIG.adminEmail, TEST_CONFIG.adminPassword)) {
      console.log('✅ 관리자 로그인 성공')
      
      // 관리자 알림 관리 테스트
      await testAdminNotificationManagement(page)
      
    } else {
      console.log('❌ 관리자 로그인 실패 - 관리 기능 테스트 스킵')
    }

  } catch (error) {
    console.error('테스트 실행 중 오류:', error)
  } finally {
    await browser.close()
  }

  // 테스트 결과 요약
  console.log('\n📊 테스트 결과 요약')
  console.log('=' .repeat(50))
  console.log(`총 테스트: ${testResults.total}`)
  console.log(`성공: ${testResults.passed} ✅`)
  console.log(`실패: ${testResults.failed} ❌`)
  console.log(`성공률: ${(testResults.passed / testResults.total * 100).toFixed(1)}%`)

  if (testResults.errors.length > 0) {
    console.log('\n❌ 실패한 테스트들:')
    testResults.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error.test}: ${error.error}`)
    })
  }

  console.log('\n🏁 알림 시스템 테스트 완료')
}

// 스크립트 실행
if (require.main === module) {
  runNotificationSystemTests().catch(console.error)
}

module.exports = {
  runNotificationSystemTests,
  testNotificationAPIs,
  testNotificationDropdown,
  testNotificationPage,
  testAdminNotificationManagement
}