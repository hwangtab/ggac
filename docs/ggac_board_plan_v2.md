## 🧪 Phase 8: 테스트 및 배포 (1-2주)

### 8.1 테스트 환경 설정

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

### 8.2 종합 테스트 시나리오 (이메일 + 구글 인증)

```typescript
// tests/auth-complete-flow.spec.ts
import { test, expect } from '@playwright/test'

test.describe('인증 시스템 전체 플로우', () => {
  test('이메일 회원가입부터 게시글 작성까지', async ({ page }) => {
    // 1. 로그인 페이지 접근
    await page.goto('/login')
    await expect(page.locator('h1')).toContainText('경기아트콜렉티브')

    // 2. 회원가입 탭으로 전환
    await page.click('button:has-text("회원가입")')
    
    // 3. 이메일 회원가입
    const testEmail = `test-${Date.now()}@example.com`
    await page.fill('input[id="signup-email"]', testEmail)
    await page.fill('input[id="signup-password"]', 'password123')
    await page.fill('input[id="signup-confirm-password"]', 'password123')
    await page.click('button:has-text("이메일로 회원가입")')

    // 4. 가입 완료 확인
    await expect(page.locator('text=회원가입이 완료되었습니다')).toBeVisible()

    // 5. 이메일 인증 시뮬레이션 (실제로는 이메일에서 링크 클릭)
    // 테스트 환경에서는 직접 인증 처리
    
    // 6. 로그인 시도
    await page.click('button:has-text("로그인")')
    await page.fill('input[id="login-email"]', testEmail)
    await page.fill('input[id="login-password"]', 'password123')
    await page.click('button:has-text("이메일로 로그인")')

    // 7. 조합원 등록 페이지로 이동 확인
    await expect(page.url()).toContain('/register/member-info')
    
    // 8. 조합원 정보 입력
    await page.fill('input[name="displayName"]', '테스트 조합원')
    await page.fill('input[name="phoneNumber"]', '010-1234-5678')
    await page.fill('input[name="birthDate"]', '1990-01-01')
    await page.fill('input[name="realName"]', '홍길동')
    
    await page.selectOption('select[name="monthlyFee"]', '20000')
    await page.selectOption('select[name="bankName"]', '국민은행')
    await page.fill('input[name="accountNumber"]', '123-456-789012')
    await page.fill('input[name="accountHolder"]', '홍길동')
    
    await page.click('button[type="submit"]')

    // 9. 승인 대기 페이지 확인
    await expect(page.locator('h1')).toContainText('승인 대기 중')
  })

  test('구글 로그인 플로우', async ({ page }) => {
    // 1. 로그인 페이지 접근
    await page.goto('/login')

    // 2. 구글 로그인 버튼 클릭 (실제 환경에서는 OAuth 플로우 모킹 필요)
    await page.click('button:has-text("구글로 로그인")')
    
    // 테스트 환경에서는 모킹된 구글 로그인 처리
    // 실제로는 구글 OAuth 콜백을 시뮬레이션
  })

  test('비밀번호 재설정 플로우', async ({ page }) => {
    // 1. 로그인 페이지에서 비밀번호 재설정 링크 클릭
    await page.goto('/login')
    await page.click('text=비밀번호를 잊으셨나요?')

    // 2. 비밀번호 재설정 페이지
    await expect(page.url()).toContain('/reset-password')
    
    // 3. 이메일 입력 및 재설정 요청
    await page.fill('input[id="email"]', 'test@example.com')
    await page.click('button:has-text("재설정 링크 발송")')

    // 4. 발송 완료 확인
    await expect(page.locator('text=이메일을 확인하세요')).toBeVisible()
  })

  test('이메일 인증 플로우', async ({ page }) => {
    // 이메일 인증 페이지 접근 (토큰 포함)
    const mockToken = 'mock-verification-token'
    await page.goto(`/verify-email?token_hash=${mockToken}&type=signup`)

    // 인증 처리 확인 (실제 환경에서는 유효한 토큰 필요)
    await expect(page.locator('text=이메일 인증 중')).toBeVisible()
  })

  test('로그인 폼 유효성 검사', async ({ page }) => {
    await page.goto('/login')

    // 빈 필드로 로그인 시도
    await page.click('button:has-text("이메일로 로그인")')
    // 브라우저 기본 validation 메시지 확인

    // 잘못된 이메일 형식
    await page.fill('input[id="login-email"]', 'invalid-email')
    await page.fill('input[id="login-password"]', 'password')
    await page.click('button:has-text("이메일로 로그인")')
    // validation 메시지 확인
  })

  test('회원가입 폼 유효성 검사', async ({ page }) => {
    await page.goto('/login')
    await page.click('button:has-text("회원가입")')

    // 비밀번호 불일치
    await page.fill('input[id="signup-email"]', 'test@example.com')
    await page.fill('input[id="signup-password"]', 'password123')
    await page.fill('input[id="signup-confirm-password"]', 'different123')
    await page.click('button:has-text("이메일로 회원가입")')
    
    await expect(page.locator('text=비밀번호가 일치하지 않습니다')).toBeVisible()

    // 짧은 비밀번호
    await page.fill('input[id="signup-password"]', '123')
    await page.fill('input[id="signup-confirm-password"]', '123')
    await page.click('button:has-text("이메일로 회원가입")')
    
    await expect(page.locator('text=비밀번호는 6자 이상이어야 합니다')).toBeVisible()
  })
})
```

### 8.3 인증 관련 단위 테스트

```typescript
// __tests__/auth/validation.test.ts
import { validateEmail, validatePassword, validateSignupForm } from '@/utils/auth-validation'

describe('인증 유효성 검사', () => {
  describe('이메일 검증', () => {
    test('올바른 이메일 형식', () => {
      expect(validateEmail('test@example.com')).toBe(true)
      expect(validateEmail('user+label@domain.co.kr')).toBe(true)
    })

    test('잘못된 이메일 형식', () => {
      expect(validateEmail('invalid-email')).toBe(false)
      expect(validateEmail('@domain.com')).toBe(false)
      expect(validateEmail('user@')).toBe(false)
    })
  })

  describe('비밀번호 검증', () => {
    test('올바른 비밀번호', () => {
      expect(validatePassword('password123')).toEqual({ isValid: true, errors: [] })
      expect(validatePassword('mySecurePass456')).toEqual({ isValid: true, errors: [] })
    })

    test('짧은 비밀번호', () => {
      const result = validatePassword('123')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('비밀번호는 6자 이상이어야 합니다')
    })
  })

  describe('회원가입 폼 검증', () => {
    test('올바른 회원가입 정보', () => {
      const formData = {
        email: 'test@example.com',
        password: 'password123',
        confirmPassword: 'password123'
      }
      
      const result = validateSignupForm(formData)
      expect(result.isValid).toBe(true)
    })

    test('비밀번호 불일치', () => {
      const formData = {
        email: 'test@example.com',
        password: 'password123',
        confirmPassword: 'different123'
      }
      
      const result = validateSignupForm(formData)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('비밀번호가 일치하지 않습니다')
    })
  })
})
```

### 8.4 유틸리티 함수 추가

```typescript
// src/utils/auth-validation.ts
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (password.length < 6) {
    errors.push('비밀번호는 6자 이상이어야 합니다')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

export const validateSignupForm = (formData: {
  email: string
  password: string
  confirmPassword: string
}): { isValid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (!validateEmail(formData.email)) {
    errors.push('올바른 이메일 형식이 아닙니다')
  }
  
  const passwordValidation = validatePassword(formData.password)
  if (!passwordValidation.isValid) {
    errors.push(...passwordValidation.errors)
  }
  
  if (formData.password !== formData.confirmPassword) {
    errors.push('비밀번호가 일치하지 않습니다')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}
```

### 8.5 보안 테스트

```typescript
// tests/security.spec.ts
import { test, expect } from '@playwright/test'

test.describe('보안 테스트', () => {
  test('미인증 사용자 보호된 경로 접근 차단', async ({ page }) => {
    // 게시판 직접 접근 시도
    await page.goto('/board')
    await expect(page.url()).toContain('/login')

    // 관리자 페이지 직접 접근 시도
    await page.goto('/admin')
    await expect(page.url()).toContain('/login')
  })

  test('SQL 인젝션 시도 방어', async ({ page }) => {
    await page.goto('/login')
    
    // SQL 인젝션 시도
    await page.fill('input[id="login-email"]', "'; DROP TABLE users; --")
    await page.fill('input[id="login-password"]', 'password')
    await page.click('button:has-text("이메일로 로그인")')
    
    // 에러가 발생하지 않고 정상적으로 처리되어야 함
    await expect(page.locator('text=이메일 또는 비밀번호가 올바르지 않습니다')).toBeVisible()
  })

  test('XSS 공격 시도 방어', async ({ page }) => {
    await page.goto('/login')
    await page.click('button:has-text("회원가입")')
    
    // XSS 시도
    const xssPayload = '<script>alert("xss")</script>'
    await page.fill('input[id="signup-email"]', `test${xssPayload}@example.com`)
    
    // 스크립트가 실행되지 않아야 함
    page.on('dialog', async dialog => {
      // alert가 뜨면 테스트 실패
      expect(dialog.message()).not.toBe('xss')
      await dialog.dismiss()
    })
  })

  test('CSRF 보호 확인', async ({ page }) => {
    // Supabase Auth는 기본적으로 CSRF 보호 제공
    // 외부에서 API 호출 시도 시 실패해야 함
    
    const response = await page.request.post('/api/auth/signin', {
      data: {
        email: 'test@example.com',
        password: 'password123'
      }
    })
    
    // 적절한 CORS 헤더 또는 인증 실패 응답 확인
    expect(response.status()).not.toBe(200)
  })
})
```

### 8.6 접근성 테스트

```typescript
// tests/accessibility.spec.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('접근성 테스트', () => {
  test('로그인 페이지 접근성', async ({ page }) => {
    await page.goto('/login')
    
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()
    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('키보드 네비게이션', async ({ page }) => {
    await page.goto('/login')
    
    // Tab 키로 네비게이션 테스트
    await page.keyboard.press('Tab') // 이메일 필드로 포커스
    await expect(page.locator('input[id="login-email"]')).toBeFocused()
    
    await page.keyboard.press('Tab') // 비밀번호 필드로 포커스
    await expect(page.locator('input[id="login-password"]')).toBeFocused()
    
    await page.keyboard.press('Tab') // 로그인 버튼으로 포커스
    await expect(page.locator('button:has-text("이메일로 로그인")')).toBeFocused()
  })

  test('스크린 리더 지원', async ({ page }) => {
    await page.goto('/login')
    
    // label과 input 연결 확인
    const emailInput = page.locator('input[id="login-email"]')
    const emailLabel = page.locator('label[for="login-email"]')
    
    await expect(emailLabel).toBeVisible()
    await expect(emailInput).toHaveAttribute('aria-labelledby')
  })
})
```

### 8.7 성능 테스트 (인증 포함)

```typescript
// tests/performance-auth.spec.ts
import { test, expect } from '@playwright/test'

test.describe('인증 관련 성능 테스트', () => {
  test('로그인 페이지 로드 성능', async ({ page }) => {
    const startTime = Date.now()
    
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    
    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(2000) // 2초 이내
  })

  test('이메일 회원가입 응답 시간', async ({ page }) => {
    await page.goto('/login')
    await page.click('button:has-text("회원가입")')
    
    await page.fill('input[id="signup-email"]', 'performance@test.com')
    await page.fill('input[id="signup-password"]', 'password123')
    await page.fill('input[id="signup-confirm-password"]', 'password123')
    
    const startTime = Date.now()
    await page.click('button:has-text("이메일로 회원가입")')
    
    // 성공 메시지 또는 에러 메시지가 나타날 때까지 시간 측정
    await page.waitForSelector('text=회원가입이 완료되었습니다', { timeout: 10000 })
    const responseTime = Date.now() - startTime
    
    expect(responseTime).toBeLessThan(5000) // 5초 이내
  })

  test('구글 OAuth 리디렉션 성능', async ({ page }) => {
    await page.goto('/login')
    
    const startTime = Date.now()
    await page.click('button:has-text("구글로 로그인")')
    
    // 구글 로그인 페이지로 리디렉션 확인
    await page.waitForURL('**/accounts.google.com/**', { timeout: 10000 })
    const redirectTime = Date.now() - startTime
    
    expect(redirectTime).toBeLessThan(3000) // 3초 이내
  })
})
```

## 📊 성공 지표 및 모니터링 (업데이트)

### 측정 지표

#### 기술적 지표
- **보안**: 
  - 비인가 접근 시도 0건
  - 개인정보 유출 사고 0건
  - 이메일 인증 우회 시도 차단 100%
  - SQL 인젝션/XSS 공격 방어 성공률 100%
- **성능**: 
  - 로그인 페이지 로드 시간 < 2초
  - 이메일 인증 처리 시간 < 5초
  - 비밀번호 재설정 이메일 발송 < 10초
  - 모바일 페이지 스피드 인사이트 90점 이상
- **가용성**: 
  - 99.9% 업타임
  - 이메일 발송 성공률 > 99%
  - 에러율 < 0.1%

#### 사용자 지표
- **가입 및 인증**:
  - 이메일 회원가입 성공률 > 90%
  - 구글 로그인 성공률 > 95%
  - 이메일 인증 완료율 > 85%
  - 비밀번호 재설정 성공률 > 90%
- **조합원 등록**:
  - 인증 후 조합원 등록 완료율 > 85%
  - 평균 승인 처리 시간 < 24시간
- **활성도**:
  - 주간 활성 조합원 > 80%
  - 월 평균 게시글 > 20개
  - 사용자 만족도 > 4.5/5.0

### 모니터링 도구 설정 (업데이트)

```typescript
// src/lib/analytics.ts
export const analytics = {
  // 인증 관련 이벤트 추가
  trackAuth: (event: string, method: 'email' | 'google', success: boolean, error?: string) => {
    if (typeof window !== 'undefined') {
      window.gtag?.('event', event, {
        auth_method: method,
        success: success,
        error_message: error,
        timestamp: new Date().toISOString()
      })
    }
  },

  trackMemberRegistration: (stage: 'started' | 'completed' | 'approved' | 'rejected', data?: any) => {
    if (typeof window !== 'undefined') {
      window.gtag?.('event', 'member_registration', {
        registration_stage: stage,
        monthly_fee: data?.monthly_fee,
        auth_method: data?.auth_method,
        timestamp: new Date().toISOString()
      })
    }
  },

  // 기존 이벤트들
  track: (event: string, properties?: Record<string, any>) => {
    if (typeof window !== 'undefined') {
      window.gtag?.('event', event, properties)
      console.log('Analytics:', event, properties)
    }
  },
  
  page: (url: string, title?: string) => {
    if (typeof window !== 'undefined') {
      window.gtag?.('config', 'GA_MEASUREMENT_ID', {
        page_location: url,
        page_title: title
      })
    }
  }
}

// 사용 예시
analytics.trackAuth('signup_attempt', 'email', true)
analytics.trackAuth('login_failed', 'google', false, 'OAuth cancelled by user')
analytics.trackMemberRegistration('completed', { 
  monthly_fee: 20000, 
  auth_method: 'email' 
})
```

## 💰 최종 예상 비용 (업데이트)

### 개발 비용
- **총 개발 기간**: 8-12주 (이메일 인증 시스템 추가로 연장)
- **총 개발 시간**: 약 240시간
- **Phase별 분배**:
  - Phase 1: 프로젝트 설정 (20시간)
  - Phase 2: 인증 시스템 (이메일 + 구글) (60시간)
  - Phase 3: 조합원 등록 시스템 (40시간)
  - Phase 4: 게시판 기능 (40시간)
  - Phase 5: 관리자 시스템 (30시간)
  - Phase 6: 알림 시스템 (20시간)
  - Phase 7: UI/UX 및 모바일 최적화 (20시간)
  - Phase 8: 테스트 및 배포 (10시간)

### 월간 운영 비용
- **Supabase Pro**: $25/월 (이메일 인증, 스토리지 포함)
- **Vercel Pro**: $20/월  
- **Resend Pro**: $20/월 (이메일 발송)
- **도메인**: $1/월 (연간 $12)
- **Sentry**: $26/월 (에러 모니터링)
- **예비비**: $8/월

**총 월간 비용**: $100/월 (약 13만원)

### 연간 총 비용
- **운영비**: $1,200/년
- **예상 추가 비용**: $300/년 (트래픽 증가, 업그레이드)
- **총 연간 비용**: $1,500/년 (약 200만원)

## 🚀 배포 계획 (업데이트)

### 단계별 배포 일정

#### 1-2주차: 개발 환경 설정
- [ ] Next.js 프로젝트 생성
- [ ] Supabase 프로젝트 설정 (이메일 + 구글 인증)
- [ ] GitHub 저장소 설정
- [ ] 기본 CI/CD 파이프라인 구축

#### 3-5주차: 인증 시스템 개발
- [ ] 이메일 회원가입/로그인 구현
- [ ] 구글 OAuth 인증 구현
- [ ] 이메일 인증 시스템
- [ ] 비밀번호 재설정 기능
- [ ] 인증 관련 보안 강화

#### 6-7주차: 조합원 등록 시스템
- [ ] 조합원 정보 입력 폼
- [ ] 데이터베이스 스키마 구축
- [ ] 미들웨어 보안 구현

#### 8-9주차: 게시판 및 관리 시스템
- [ ] 게시판 CRUD 기능
- [ ] 관리자 승인 시스템
- [ ] 이메일 알림 시스템

#### 10-11주차: UI/UX 및 최적화
- [ ] 반응형 디자인 완성
- [ ] PWA 구현
- [ ] 성능 최적화

#### 12주차: 테스트 및 정식 출시
- [ ] 종합 테스트 (E2E, 보안, 성능, 접근성)
- [ ] 베타 테스트 및 피드백 수집
- [ ] 프로덕션 배포
- [ ] 모니터링 시스템 가동

## 🔒 보안 고려사항 (이메일 인증 추가)

### 이메일 인증 보안
- **토큰 만료**: 이메일 인증 토큰 24시간 만료
- **일회성 토큰**: 사용된 토큰 즉시 무효화
- **재전송 제한**: 5분 간격으로 재전송 제한
- **브루트포스 방어**: IP별 시도 횟수 제한

### 비밀번호 보안
- **최소 복잡도**: 6자 이상 (추후 8자로 강화 고려)
- **해시 알고리즘**: Supabase bcrypt 기본 사용
- **재설정 토큰**: 1시간 만료, 일회성 사용
- **이력 관리**: 최근 5개 비밀번호 재사용 방지 (선택사항)

### 세션 관리
- **세션 만료**: 7일 후 자동 로그아웃
- **기기별 세션**: 다중 기기 로그인 허용
- **보안 로그**: 로그인 시도, IP, 기기 정보 기록
- **의심 활동**: 비정상 로그인 패턴 감지 시 알림

---

**📝 문서 버전**: v4.0 (이메일 + 구글 인증)  
**최종 업데이트**: 2025년 7월 7일  
**프로젝트 상태**: 구현 대기  
**예상 완료**: 2025년 10월 초

**🎯 핵심 목표**:
1. ✅ 다양한 인증 방식 지원 (이메일 + 구글)
2. ✅ 안전한 조합원 전용 커뮤니티 구축
3. ✅ 직관적이고 사용하기 쉬운 인터페이스
4. ✅ 체계적인 조합원 관리 시스템
5. ✅ 확장 가능하고 유지보수가 쉬운 구조

**🔐 보안 강화 사항**:
- 이메일 인증 필수화
- 비밀번호 재설정 기능
- 다단계 보안 검증
- 세션 관리 및 보안 로깅

이제 사용자들이 구글 계정이 없어도 일반 이메일로 가입할 수 있으며, 더욱 안전하고 포괄적인 인증 시스템을 제공합니다.### 2.3 인증 콜백 처리

```typescript
// src/app/auth/callback/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    
    try {
      await supabase.auth.exchangeCodeForSession(code)
      
      // 사용자 프로필 확인
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // 신규 사용자 - 조합원 등록 페이지로
          return NextResponse.redirect(`${requestUrl.origin}/register/member-info`)
        }

        if (profile.registration_status === 'pending') {
          // 승인 대기 중
          return NextResponse.redirect(`${requestUrl.origin}/register/pending`)
        }

        if (profile.registration_status === 'approved' && profile.is_active) {
          // 승인된 조합원 - 게시판으로
          return NextResponse.redirect(`${requestUrl.origin}/board`)
        }

        // 거절되었거나 비활성화된 경우
        return NextResponse.redirect(`${requestUrl.origin}/register/rejected`)
      }
    } catch (error) {
      console.error('Auth callback error:', error)
    }
  }

  // 오류 발생 시 로그인 페이지로
  return NextResponse.redirect(`${requestUrl.origin}/login`)
}
```

### 2.4 비밀번호 재설정 기능

```typescript
// src/app/reset-password/page.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ArrowLeft, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email) {
      toast.error('이메일을 입력해주세요.')
      return
    }

    try {
      setLoading(true)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password/update`
      })

      if (error) {
        toast.error('비밀번호 재설정 요청 중 오류가 발생했습니다.')
        return
      }

      setSent(true)
      toast.success('비밀번호 재설정 이메일을 발송했습니다!')
    } catch (error) {
      toast.error('요청 중 오류가 발생했습니다.')
      console.error('Reset password error:', error)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-green-600" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              이메일을 확인하세요
            </h2>
            
            <p className="text-gray-600 mb-6">
              <strong>{email}</strong>으로<br />
              비밀번호 재설정 링크를 발송했습니다.
            </p>
            
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                이메일이 도착하지 않았나요?
              </p>
              <Button
                onClick={() => setSent(false)}
                variant="outline"
                className="w-full"
              >
                다시 시도
              </Button>
              <Link href="/login">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  로그인으로 돌아가기
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">비밀번호 재설정</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <Label htmlFor="email">이메일 주소</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                가입할 때 사용한 이메일 주소를 입력해주세요.
              </p>
            </div>

            <div className="space-y-3">
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={loading}
              >
                {loading ? '발송 중...' : '재설정 링크 발송'}
              </Button>

              <Link href="/login">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  로그인으로 돌아가기
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

### 2.5 비밀번호 업데이트 페이지

```typescript
// src/app/reset-password/update/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Eye, EyeOff, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  })

  useEffect(() => {
    // URL 해시에서 토큰 확인
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')

    if (!accessToken) {
      toast.error('유효하지 않은 재설정 링크입니다.')
      router.push('/login')
    }
  }, [router])

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.password || !formData.confirmPassword) {
      toast.error('모든 필드를 입력해주세요.')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error('비밀번호가 일치하지 않습니다.')
      return
    }

    if (formData.password.length < 6) {
      toast.error('비밀번호는 6자 이상이어야 합니다.')
      return
    }

    try {
      setLoading(true)
      const { error } = await supabase.auth.updateUser({
        password: formData.password
      })

      if (error) {
        toast.error('비밀번호 업데이트 중 오류가 발생했습니다.')
        return
      }

      toast.success('비밀번호가 성공적으로 변경되었습니다!')
      router.push('/login')
    } catch (error) {
      toast.error('요청 중 오류가 발생했습니다.')
      console.error('Update password error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center flex items-center justify-center space-x-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span>새 비밀번호 설정</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div>
              <Label htmlFor="password">새 비밀번호</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="6자 이상 입력"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="비밀번호 다시 입력"
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={loading}
            >
              {loading ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

### 2.6 이메일 인증 확인 페이지

```typescript
// src/app/verify-email/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Mail, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

export default function VerifyEmailPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [email, setEmail] = useState('')

  useEffect(() => {
    const verifyEmail = async () => {
      const token_hash = searchParams.get('token_hash')
      const type = searchParams.get('type')

      if (type === 'signup' && token_hash) {
        try {
          const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type: 'email'
          })

          if (error) {
            setStatus('error')
            toast.error('이메일 인증에 실패했습니다.')
          } else {
            setStatus('success')
            toast.success('이메일 인증이 완료되었습니다!')
            // 조합원 등록 페이지로 이동
            setTimeout(() => {
              router.push('/register/member-info')
            }, 2000)
          }
        } catch (error) {
          setStatus('error')
          console.error('Email verification error:', error)
        }
      } else {
        setStatus('error')
      }
    }

    verifyEmail()
  }, [searchParams, router, supabase])

  const resendVerification = async () => {
    if (!email) {
      toast.error('이메일을 입력해주세요.')
      return
    }

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email
      })

      if (error) {
        toast.error('인증 이메일 재발송에 실패했습니다.')
      } else {
        toast.success('인증 이메일을 다시 발송했습니다.')
      }
    } catch (error) {
      toast.error('요청 중 오류가 발생했습니다.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                이메일 인증 중...
              </h2>
              <p className="text-gray-600">
                잠시만 기다려주세요.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                인증 완료!
              </h2>
              <p className="text-gray-600 mb-4">
                이메일 인증이 성공적으로 완료되었습니다.<br />
                조합원 등록 페이지로 이동합니다.
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                인증 실패
              </h2>
              <p className="text-gray-600 mb-4">
                이메일 인증에 실패했습니다.<br />
                링크가 만료되었거나 잘못되었을 수 있습니다.
              </p>
              
              <div className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="이메일 주소 입력"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  onClick={resendVerification}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  인증 이메일 다시 발송
                </Button>
                <Button
                  onClick={() => router.push('/login')}
                  variant="outline"
                  className="w-full"
                >
                  로그인 페이지로 돌아가기
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

### 2.7 미들웨어 개선 (이메일 인증 체크 추가)

```typescript
// src/middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req: request, res })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 보호된 경로 정의
  const protectedPaths = ['/board', '/admin']
  const authPaths = ['/login', '/register']
  const emailVerificationPaths = ['/verify-email', '/reset-password']
  
  const isProtectedPath = protectedPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )
  const isAuthPath = authPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )
  const isEmailVerificationPath = emailVerificationPaths.some(path =>
    request.nextUrl.pathname.startsWith(path)
  )

  // 이메일 인증 관련 페이지는 통과
  if (isEmailVerificationPath) {
    return res
  }

  // 인증되지 않은 사용자가 보호된 경로 접근 시
  if (isProtectedPath && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 인증된 사용자가 인증 페이지 접근 시
  if (isAuthPath && user) {
    // 이메일 인증 확인
    if (!user.email_confirmed_at) {
      // 이메일 미인증 상태면 로그아웃 후 로그인 페이지 유지
      await supabase.auth.signOut()
      return res
    }
    
    return NextResponse.redirect(new URL('/board', request.url))
  }

  // 게시판 접근 시 조합원 상태 확인
  if (user && request.nextUrl.pathname.startsWith('/board')) {
    // 이메일 인증 확인
    if (!user.email_confirmed_at) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.redirect(new URL('/register/member-info', request.url))
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.redirect(new URL('/register/pending', request.url))
    }
  }

  // 관리자 페이지 접근 시 관리자 권한 확인
  if (user && request.nextUrl.pathname.startsWith('/admin')) {
    if (!user.email_confirmed_at) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, is_active')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin || !profile?.is_active) {
      return NextResponse.redirect(new URL('/board', request.url))
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback).*)',
  ],
}
```

### 2.8 로그인 페이지에 비밀번호 재설정 링크 추가

```typescript
// 로그인 탭 하단에 추가
<div className="text-center">
  <Link 
    href="/reset-password" 
    className="text-sm text-blue-600 hover:text-blue-800"
  >
    비밀번호를 잊으셨나요?
  </Link>
</div>
```

### 2.9 환경변수 업데이트

```env
# .env.local에 추가
# 이메일 설정
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true

# 구글 OAuth (기존)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```# 경기아트콜렉티브 조합원 게시판 구현 계획서

> **작성일**: 2025년 7월 7일  
> **프로젝트**: 조합원 전용 커뮤니티 플랫폼 구축  
> **목표**: 처음부터 안전하고 완성도 높은 조합원 게시판 시스템 개발

## 📋 프로젝트 개요

### 🎯 구현 목표
- **조합원 전용** 안전한 커뮤니티 공간 구축
- **구글 간편 로그인** 기반 인증 시스템
- **체계적인 조합원 관리** 시스템
- **직관적이고 반응형** 사용자 인터페이스

### 📱 주요 기능
1. **인증 시스템**: 구글 OAuth 2.0 로그인
2. **조합원 등록**: 상세 정보 입력 및 관리자 승인
3. **게시판 기능**: 게시글 작성, 조회, 수정, 삭제
4. **관리자 도구**: 조합원 승인 및 관리
5. **알림 시스템**: 이메일 및 실시간 알림

### 🛠 기술 스택
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Storage)
- **배포**: Vercel
- **알림**: Resend (이메일)
- **상태관리**: React Query (TanStack Query)

## 🚀 Phase 1: 프로젝트 초기 설정 및 기본 구조 (1주)

### 1.1 프로젝트 초기화

#### Next.js 프로젝트 생성
```bash
npx create-next-app@latest ggac-board --typescript --tailwind --eslint --app
cd ggac-board

# 필요한 패키지 설치
npm install @supabase/supabase-js @supabase/auth-ui-react
npm install @tanstack/react-query react-hot-toast
npm install lucide-react date-fns
npm install -D @types/node

# 개발 도구
npm install -D prettier eslint-config-prettier
npm install -D @playwright/test
```

#### 프로젝트 구조 설정
```
src/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── login/
│   │   └── page.tsx
│   ├── register/
│   │   ├── member-info/
│   │   │   └── page.tsx
│   │   └── pending/
│   │       └── page.tsx
│   ├── board/
│   │   ├── page.tsx
│   │   └── loading.tsx
│   └── admin/
│       ├── members/
│       │   └── page.tsx
│       └── layout.tsx
├── components/
│   ├── auth/
│   ├── board/
│   ├── admin/
│   └── common/
├── lib/
│   ├── supabase.ts
│   └── utils.ts
├── hooks/
├── types/
└── middleware.ts
```

### 1.2 Supabase 프로젝트 설정

#### Supabase 설정
```bash
# Supabase CLI 설치
npm install -g supabase

# 프로젝트 초기화
supabase init
supabase start
```

#### 환경변수 설정
```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# 기타
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENCRYPTION_KEY=your_encryption_key_32_chars
```

#### Supabase 클라이언트 설정
```typescript
// src/lib/supabase.ts
import { createClientComponentClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const createClient = () => createClientComponentClient()

export const createServerClient = () => 
  createServerComponentClient({ cookies })

// 타입 정의
export type Database = {
  public: {
    Tables: {
      member_profiles: {
        Row: MemberProfile
        Insert: MemberProfileInsert
        Update: MemberProfileUpdate
      }
      posts: {
        Row: Post
        Insert: PostInsert
        Update: PostUpdate
      }
    }
  }
}
```

### 1.3 기본 데이터베이스 스키마 구축

#### 마이그레이션 파일 생성
```sql
-- supabase/migrations/20250707000001_initial_setup.sql

-- 조합원 프로필 테이블
CREATE TABLE member_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  
  -- 기본 정보
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT NOT NULL,
  birth_date DATE NOT NULL,
  real_name TEXT NOT NULL,
  
  -- 조합비 정보
  monthly_fee INTEGER NOT NULL CHECK (monthly_fee >= 10000 AND monthly_fee <= 50000),
  
  -- 계좌 정보
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  
  -- 상태 관리
  registration_status TEXT DEFAULT 'pending' 
    CHECK (registration_status IN ('pending', 'approved', 'rejected')),
  is_active BOOLEAN DEFAULT FALSE,
  
  -- 관리자 정보
  is_admin BOOLEAN DEFAULT FALSE,
  
  -- 메타데이터
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID REFERENCES auth.users(id)
);

-- 게시글 테이블
CREATE TABLE posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

-- RLS 정책 활성화
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- 본인 프로필 조회/수정 가능
CREATE POLICY "Users can view own profile" ON member_profiles 
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can insert own profile" ON member_profiles 
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile" ON member_profiles 
  FOR UPDATE USING (id = auth.uid());

-- 관리자는 모든 프로필 조회 가능
CREATE POLICY "Admins can view all profiles" ON member_profiles 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles admin_profile
      WHERE admin_profile.id = auth.uid() 
      AND admin_profile.is_admin = true
      AND admin_profile.is_active = true
    )
  );

-- 관리자는 승인 상태 변경 가능
CREATE POLICY "Admins can approve members" ON member_profiles 
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM member_profiles admin_profile
      WHERE admin_profile.id = auth.uid() 
      AND admin_profile.is_admin = true
      AND admin_profile.is_active = true
    )
  );

-- 승인된 조합원만 게시글 조회 가능
CREATE POLICY "Approved members can view posts" ON posts 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    ) AND is_deleted = false
  );

-- 승인된 조합원만 게시글 작성 가능
CREATE POLICY "Approved members can create posts" ON posts 
  FOR INSERT WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'
      AND member_profiles.is_active = true
    )
  );

-- 작성자만 자신의 게시글 수정/삭제 가능
CREATE POLICY "Authors can update own posts" ON posts 
  FOR UPDATE USING (author_id = auth.uid());

-- 인덱스 생성
CREATE INDEX idx_member_profiles_status ON member_profiles(registration_status, is_active);
CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
```

## 🔐 Phase 2: 인증 시스템 구현 (1-2주)

### 2.1 인증 제공자 설정

#### Supabase 대시보드 설정
1. **이메일 인증 설정**
   - Authentication → Settings → Auth
   - Enable email confirmations: ON
   - Email templates 커스터마이징

2. **구글 OAuth 설정**
   - Authentication → Providers → Google 활성화
   - Client ID, Client Secret 입력
   - Redirect URL: `https://your-project.supabase.co/auth/v1/callback`

#### 구글 클라우드 콘솔 설정
1. Google Cloud Console → APIs & Services → Credentials
2. OAuth 2.0 Client ID 생성
3. Authorized redirect URIs 추가
4. Client ID, Secret 복사하여 Supabase에 입력

### 2.2 로그인/회원가입 페이지 구현

```typescript
// src/app/login/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Chrome, Mail, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'

export default function AuthPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  // 로그인 폼 상태
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: ''
  })
  
  // 회원가입 폼 상태
  const [signupForm, setSignupForm] = useState({
    email: '',
    password: '',
    confirmPassword: ''
  })

  useEffect(() => {
    // 이미 로그인된 사용자 체크
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push('/board')
      }
    }
    checkUser()
  }, [router, supabase])

  // 구글 로그인
  const handleGoogleLogin = async () => {
    try {
      setLoading(true)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        toast.error('구글 로그인 중 오류가 발생했습니다.')
        console.error('Google login error:', error)
      }
    } catch (error) {
      toast.error('로그인 요청 중 오류가 발생했습니다.')
      console.error('Login request error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 이메일 로그인
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!loginForm.email || !loginForm.password) {
      toast.error('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password
      })

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast.error('이메일 또는 비밀번호가 올바르지 않습니다.')
        } else if (error.message.includes('Email not confirmed')) {
          toast.error('이메일 인증을 완료해주세요.')
        } else {
          toast.error('로그인 중 오류가 발생했습니다.')
        }
        return
      }

      if (data.user) {
        toast.success('로그인되었습니다!')
        router.push('/auth/callback')
      }
    } catch (error) {
      toast.error('로그인 요청 중 오류가 발생했습니다.')
      console.error('Email login error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 이메일 회원가입
  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!signupForm.email || !signupForm.password || !signupForm.confirmPassword) {
      toast.error('모든 필드를 입력해주세요.')
      return
    }

    if (signupForm.password !== signupForm.confirmPassword) {
      toast.error('비밀번호가 일치하지 않습니다.')
      return
    }

    if (signupForm.password.length < 6) {
      toast.error('비밀번호는 6자 이상이어야 합니다.')
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase.auth.signUp({
        email: signupForm.email,
        password: signupForm.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        if (error.message.includes('User already registered')) {
          toast.error('이미 가입된 이메일입니다.')
        } else {
          toast.error('회원가입 중 오류가 발생했습니다.')
        }
        return
      }

      if (data.user) {
        toast.success('회원가입이 완료되었습니다! 이메일을 확인해주세요.')
        // 이메일 인증 대기 페이지로 이동하거나 로그인 탭으로 전환
        setSignupForm({ email: '', password: '', confirmPassword: '' })
      }
    } catch (error) {
      toast.error('회원가입 요청 중 오류가 발생했습니다.')
      console.error('Email signup error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            경기아트콜렉티브
          </h1>
          <p className="text-gray-600">
            조합원 전용 커뮤니티에 오신 것을 환영합니다
          </p>
        </div>

        <Tabs defaultValue="login" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">로그인</TabsTrigger>
            <TabsTrigger value="signup">회원가입</TabsTrigger>
          </TabsList>

          {/* 로그인 탭 */}
          <TabsContent value="login" className="space-y-4">
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <Label htmlFor="login-email">이메일</Label>
                <Input
                  id="login-email"
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="your@email.com"
                  required
                />
              </div>

              <div>
                <Label htmlFor="login-password">비밀번호</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="비밀번호"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={loading}
              >
                {loading ? '로그인 중...' : '이메일로 로그인'}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">또는</span>
              </div>
            </div>

            <Button
              onClick={handleGoogleLogin}
              className="w-full h-12 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center justify-center space-x-3"
              variant="outline"
              disabled={loading}
            >
              <Chrome className="w-5 h-5" />
              <span>구글로 로그인</span>
            </Button>
          </TabsContent>

          {/* 회원가입 탭 */}
          <TabsContent value="signup" className="space-y-4">
            <form onSubmit={handleEmailSignup} className="space-y-4">
              <div>
                <Label htmlFor="signup-email">이메일</Label>
                <Input
                  id="signup-email"
                  type="email"
                  value={signupForm.email}
                  onChange={(e) => setSignupForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="your@email.com"
                  required
                />
              </div>

              <div>
                <Label htmlFor="signup-password">비밀번호</Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    value={signupForm.password}
                    onChange={(e) => setSignupForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="6자 이상 입력"
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="signup-confirm-password">비밀번호 확인</Label>
                <div className="relative">
                  <Input
                    id="signup-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={signupForm.confirmPassword}
                    onChange={(e) => setSignupForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="비밀번호 다시 입력"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={loading}
              >
                {loading ? '가입 중...' : '이메일로 회원가입'}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">또는</span>
              </div>
            </div>

            <Button
              onClick={handleGoogleLogin}
              className="w-full h-12 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center justify-center space-x-3"
              variant="outline"
              disabled={loading}
            >
              <Chrome className="w-5 h-5" />
              <span>구글로 가입하기</span>
            </Button>
          </TabsContent>
        </Tabs>

        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            조합원이 아니신가요?{' '}
            <a href="mailto:info@ggac.co.kr" className="text-blue-600 hover:text-blue-800">
              조합 가입 문의
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
```

### 2.3 인증 콜백 처리

```typescript
// src/app/auth/callback/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    
    try {
      await supabase.auth.exchangeCodeForSession(code)
      
      // 사용자 프로필 확인
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const { data: profile } = await supabase
          .from('member_profiles')
          .select('registration_status, is_active')
          .eq('id', user.id)
          .single()

        if (!profile) {
          // 신규 사용자 - 조합원 등록 페이지로
          return NextResponse.redirect(`${requestUrl.origin}/register/member-info`)
        }

        if (profile.registration_status === 'pending') {
          // 승인 대기 중
          return NextResponse.redirect(`${requestUrl.origin}/register/pending`)
        }

        if (profile.registration_status === 'approved' && profile.is_active) {
          // 승인된 조합원 - 게시판으로
          return NextResponse.redirect(`${requestUrl.origin}/board`)
        }

        // 거절되었거나 비활성화된 경우
        return NextResponse.redirect(`${requestUrl.origin}/register/rejected`)
      }
    } catch (error) {
      console.error('Auth callback error:', error)
    }
  }

  // 오류 발생 시 로그인 페이지로
  return NextResponse.redirect(`${requestUrl.origin}/login`)
}
```

### 2.4 미들웨어 구현

```typescript
// src/middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req: request, res })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 보호된 경로 정의
  const protectedPaths = ['/board', '/admin']
  const authPaths = ['/login', '/register']
  
  const isProtectedPath = protectedPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )
  const isAuthPath = authPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  // 인증되지 않은 사용자가 보호된 경로 접근 시
  if (isProtectedPath && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 인증된 사용자가 인증 페이지 접근 시
  if (isAuthPath && user) {
    return NextResponse.redirect(new URL('/board', request.url))
  }

  // 게시판 접근 시 조합원 상태 확인
  if (user && request.nextUrl.pathname.startsWith('/board')) {
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.redirect(new URL('/register/member-info', request.url))
    }

    if (profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.redirect(new URL('/register/pending', request.url))
    }
  }

  // 관리자 페이지 접근 시 관리자 권한 확인
  if (user && request.nextUrl.pathname.startsWith('/admin')) {
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, is_active')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin || !profile?.is_active) {
      return NextResponse.redirect(new URL('/board', request.url))
    }
  }

  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback).*)',
  ],
}
```

## 📝 Phase 3: 조합원 등록 시스템 구현 (1-2주)

### 3.1 타입 정의

```typescript
// src/types/index.ts
export interface MemberProfile {
  id: string
  display_name: string
  email: string
  phone_number: string
  birth_date: string
  real_name: string
  monthly_fee: number
  bank_name: string
  account_number: string
  account_holder: string
  registration_status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
  is_admin: boolean
  created_at: string
  updated_at: string
  approved_at?: string
  approved_by?: string
}

export interface MemberRegistrationForm {
  display_name: string
  phone_number: string
  birth_date: string
  real_name: string
  monthly_fee: number
  bank_name: string
  account_number: string
  account_holder: string
}

export interface Post {
  id: string
  title: string
  content: string
  author_id: string
  created_at: string
  updated_at: string
  is_deleted: boolean
}

export interface PostWithAuthor extends Post {
  member_profiles: {
    display_name: string
    is_admin: boolean
  }
}
```

### 3.2 조합원 등록 폼 구현

```typescript
// src/app/register/member-info/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { MemberRegistrationForm } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import toast from 'react-hot-toast'

export default function MemberRegistrationPage() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<MemberRegistrationForm>({
    display_name: '',
    phone_number: '',
    birth_date: '',
    real_name: '',
    monthly_fee: 10000,
    bank_name: '',
    account_number: '',
    account_holder: ''
  })

  const bankOptions = [
    '국민은행', '신한은행', '우리은행', '하나은행', 
    '농협은행', '기업은행', 'SC제일은행', '대구은행',
    '부산은행', '광주은행', '제주은행', '전북은행',
    '경남은행', '중소기업은행', '한국산업은행',
    '카카오뱅크', '토스뱅크', '케이뱅크',
    '새마을금고', '신협', '우체국'
  ]

  const monthlyFeeOptions = Array.from({ length: 9 }, (_, i) => {
    const amount = 10000 + (i * 5000)
    return {
      value: amount,
      label: `${amount.toLocaleString()}원`
    }
  })

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      setUser(user)
      
      // 이미 등록된 사용자인지 확인
      const { data: profile } = await supabase
        .from('member_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profile) {
        if (profile.registration_status === 'pending') {
          router.push('/register/pending')
        } else if (profile.registration_status === 'approved') {
          router.push('/board')
        }
      }

      // 구글에서 가져온 이메일로 초기화
      setFormData(prev => ({
        ...prev,
        email: user.email || ''
      }))
    }

    getUser()
  }, [router, supabase])

  const validateForm = (): boolean => {
    const errors: string[] = []

    if (!formData.display_name.trim()) {
      errors.push('조합원 이름 또는 활동명을 입력해주세요')
    }

    if (!formData.phone_number.trim()) {
      errors.push('연락처를 입력해주세요')
    } else if (!/^01[0-9]-\d{3,4}-\d{4}$/.test(formData.phone_number)) {
      errors.push('연락처 형식이 올바르지 않습니다 (예: 010-1234-5678)')
    }

    if (!formData.birth_date) {
      errors.push('생년월일을 입력해주세요')
    }

    if (!formData.real_name.trim()) {
      errors.push('실명을 입력해주세요')
    }

    if (!formData.bank_name) {
      errors.push('은행을 선택해주세요')
    }

    if (!formData.account_number.trim()) {
      errors.push('계좌번호를 입력해주세요')
    } else if (!/^[0-9-]+$/.test(formData.account_number)) {
      errors.push('계좌번호는 숫자와 하이픈만 입력 가능합니다')
    }

    if (!formData.account_holder.trim()) {
      errors.push('예금주를 입력해주세요')
    }

    if (formData.account_holder !== formData.real_name) {
      errors.push('예금주와 실명이 일치하지 않습니다')
    }

    if (errors.length > 0) {
      errors.forEach(error => toast.error(error))
      return false
    }

    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !user) return

    setLoading(true)
    
    try {
      const { error } = await supabase
        .from('member_profiles')
        .insert([{
          id: user.id,
          email: user.email,
          ...formData
        }])

      if (error) {
        console.error('Registration error:', error)
        toast.error('등록 중 오류가 발생했습니다. 다시 시도해주세요.')
        return
      }

      toast.success('조합원 등록이 완료되었습니다!')
      router.push('/register/pending')
    } catch (error) {
      console.error('Registration error:', error)
      toast.error('등록 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: keyof MemberRegistrationForm, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  if (!user) {
    return <div>로딩 중...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-sm border p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              조합원 등록
            </h1>
            <p className="text-gray-600">
              경기아트콜렉티브 조합원이 되기 위한 정보를 입력해주세요.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* 개인정보 섹션 */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold border-b pb-2">개인정보</h3>
              
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="bank_name">출금은행 *</Label>
                  <Select 
                    value={formData.bank_name} 
                    onValueChange={(value) => handleInputChange('bank_name', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="은행을 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankOptions.map(bank => (
                        <SelectItem key={bank} value={bank}>
                          {bank}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="account_number">계좌번호 *</Label>
                  <Input
                    id="account_number"
                    value={formData.account_number}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9-]/g, '')
                      handleInputChange('account_number', value)
                    }}
                    placeholder="123-456-789012"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="account_holder">예금주 *</Label>
                  <Input
                    id="account_holder"
                    value={formData.account_holder}
                    onChange={(e) => handleInputChange('account_holder', e.target.value)}
                    placeholder="실명과 동일하게 입력"
                    required
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    예금주는 위에 입력한 실명과 정확히 일치해야 합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* 개인정보 처리 동의 */}
            <div className="bg-gray-50 rounded-lg p-6">
              <h4 className="font-semibold mb-3">개인정보 처리 방침</h4>
              <div className="text-sm text-gray-600 space-y-2">
                <p>• 수집된 개인정보는 조합원 관리 및 조합비 관리 목적으로만 사용됩니다.</p>
                <p>• 계좌정보는 암호화되어 안전하게 저장됩니다.</p>
                <p>• 개인정보는 조합 탈퇴 시 즉시 삭제됩니다.</p>
                <p>• 정보 제공을 거부할 권리가 있으나, 조합원 등록이 제한될 수 있습니다.</p>
              </div>
            </div>

            {/* 제출 버튼 */}
            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/login')}
                disabled={loading}
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? '등록 중...' : '조합원 등록 신청'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
```

### 3.3 등록 대기 페이지

```typescript
// src/app/register/pending/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Clock, Mail, Phone } from 'lucide-react'

export default function PendingApprovalPage() {
  const router = useRouter()
  const supabase = createClient()
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => {
    const checkStatus = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/login')
        return
      }

      const { data: memberProfile } = await supabase
        .from('member_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!memberProfile) {
        router.push('/register/member-info')
        return
      }

      if (memberProfile.registration_status === 'approved') {
        router.push('/board')
        return
      }

      setProfile(memberProfile)
    }

    checkStatus()

    // 실시간으로 승인 상태 체크
    const channel = supabase
      .channel('member-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'member_profiles',
          filter: `id=eq.${profile?.id}`
        },
        (payload) => {
          if (payload.new.registration_status === 'approved') {
            router.push('/board')
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router, supabase, profile?.id])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!profile) {
    return <div>로딩 중...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="w-20 h-20 mx-auto mb-6 bg-yellow-100 rounded-full flex items-center justify-center">
          <Clock className="w-10 h-10 text-yellow-600" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          승인 대기 중
        </h1>

        <p className="text-gray-600 mb-6">
          조합원 등록 신청이 완료되었습니다.<br />
          관리자 검토 후 승인 결과를 알려드립니다.
        </p>

        <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-semibold text-blue-900 mb-2">신청 정보</h3>
          <div className="space-y-1 text-sm text-blue-800">
            <p>이름: {profile.display_name}</p>
            <p>이메일: {profile.email}</p>
            <p>조합비: {profile.monthly_fee.toLocaleString()}원/월</p>
            <p>신청일: {new Date(profile.created_at).toLocaleDateString('ko-KR')}</p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h4 className="font-medium text-gray-900 mb-2">처리 안내</h4>
          <div className="text-sm text-gray-600 space-y-1">
            <p>• 평균 처리 시간: 1-2일</p>
            <p>• 승인 결과는 이메일로 알려드립니다</p>
            <p>• 추가 문의사항이 있으시면 연락주세요</p>
          </div>
        </div>

        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
            <div className="flex items-center space-x-1">
              <Mail className="w-4 h-4" />
              <span>info@ggac.co.kr</span>
            </div>
            <div className="flex items-center space-x-1">
              <Phone className="w-4 h-4" />
              <span>031-123-4567</span>
            </div>
          </div>

          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full"
          >
            로그아웃
          </Button>
        </div>
      </div>
    </div>
  )
}
```

## 📋 Phase 4: 게시판 기능 구현 (2주)

### 4.1 게시판 메인 페이지

```typescript
// src/app/board/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { PostWithAuthor } from '@/types'
import { CreatePostForm } from '@/components/board/CreatePostForm'
import { PostList } from '@/components/board/PostList'
import { BoardHeader } from '@/components/board/BoardHeader'
import { useInfiniteQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'

export default function BoardPage() {
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [supabase])

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
    refetch
  } = useInfiniteQuery({
    queryKey: ['posts'],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * 10
      const to = from + 9

      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          member_profiles:author_id (
            display_name,
            is_admin
          )
        `)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return data
    },
    getNextPageParam: (lastPage, pages) => {
      if (!lastPage || lastPage.length < 10) return undefined
      return pages.length
    },
    staleTime: 1000 * 60 * 5, // 5분
  })

  const posts = data?.pages.flat() || []

  const handlePostCreated = () => {
    setShowCreateForm(false)
    refetch()
    toast.success('게시글이 작성되었습니다!')
  }

  const handlePostUpdated = () => {
    refetch()
    toast.success('게시글이 수정되었습니다!')
  }

  const handlePostDeleted = () => {
    refetch()
    toast.success('게시글이 삭제되었습니다!')
  }

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 p-8">로딩 중...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <BoardHeader 
        user={user}
        onCreatePost={() => setShowCreateForm(true)}
      />

      <main className="max-w-4xl mx-auto px-4 py-8">
        {showCreateForm && (
          <div className="mb-8">
            <CreatePostForm
              onSuccess={handlePostCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        )}

        <PostList
          posts={posts}
          currentUser={user}
          onPostUpdated={handlePostUpdated}
          onPostDeleted={handlePostDeleted}
          onLoadMore={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetching={isFetching}
        />
      </main>
    </div>
  )
}
```

### 4.2 게시글 작성 컴포넌트

```typescript
// src/components/board/CreatePostForm.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import toast from 'react-hot-toast'

interface CreatePostFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export function CreatePostForm({ onSuccess, onCancel }: CreatePostFormProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    content: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
      return
    }

    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        toast.error('로그인이 필요합니다.')
        return
      }

      const { error } = await supabase
        .from('posts')
        .insert([{
          title: formData.title.trim(),
          content: formData.content.trim(),
          author_id: user.id
        }])

      if (error) {
        console.error('Post creation error:', error)
        toast.error('게시글 작성 중 오류가 발생했습니다.')
        return
      }

      onSuccess()
    } catch (error) {
      console.error('Post creation error:', error)
      toast.error('게시글 작성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <h2 className="text-xl font-semibold mb-4">새 게시글 작성</h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="title">제목</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            placeholder="게시글 제목을 입력하세요"
            maxLength={100}
            required
          />
        </div>

        <div>
          <Label htmlFor="content">내용</Label>
          <Textarea
            id="content"
            value={formData.content}
            onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
            placeholder="게시글 내용을 입력하세요"
            rows={8}
            maxLength={5000}
            required
          />
          <p className="text-sm text-gray-500 mt-1">
            {formData.content.length}/5000자
          </p>
        </div>

        <div className="flex justify-end space-x-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            취소
          </Button>
          <Button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? '작성 중...' : '게시글 작성'}
          </Button>
        </div>
      </form>
    </div>
  )
}
```

### 4.3 게시글 목록 컴포넌트

```typescript
// src/components/board/PostList.tsx
'use client'

import { PostWithAuthor } from '@/types'
import { PostCard } from './PostCard'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface PostListProps {
  posts: PostWithAuthor[]
  currentUser: any
  onPostUpdated: () => void
  onPostDeleted: () => void
  onLoadMore: () => void
  hasNextPage: boolean
  isFetching: boolean
}

export function PostList({
  posts,
  currentUser,
  onPostUpdated,
  onPostDeleted,
  onLoadMore,
  hasNextPage,
  isFetching
}: PostListProps) {
  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
        <p className="text-gray-500 text-lg">아직 게시글이 없습니다.</p>
        <p className="text-gray-400 mt-2">첫 번째 게시글을 작성해보세요!</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          currentUser={currentUser}
          onUpdated={onPostUpdated}
          onDeleted={onPostDeleted}
        />
      ))}

      {hasNextPage && (
        <div className="flex justify-center py-8">
          <Button
            onClick={onLoadMore}
            disabled={isFetching}
            variant="outline"
            className="px-8"
          >
            {isFetching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                로딩 중...
              </>
            ) : (
              '더 보기'
            )}
          </Button>
        </div>
      )}

      {isFetching && !hasNextPage && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}
    </div>
  )
}
```

### 4.4 게시글 카드 컴포넌트

```typescript
// src/components/board/PostCard.tsx
'use client'

import { useState } from 'react'
import { PostWithAuthor } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { MoreVertical, Edit, Trash2, Crown } from 'lucide-react'
import { EditPostModal } from './EditPostModal'
import { DeletePostDialog } from './DeletePostDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface PostCardProps {
  post: PostWithAuthor
  currentUser: any
  onUpdated: () => void
  onDeleted: () => void
}

export function PostCard({ post, currentUser, onUpdated, onDeleted }: PostCardProps) {
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const isAuthor = currentUser?.id === post.author_id
  const isAdmin = post.member_profiles?.is_admin

  const timeAgo = formatDistanceToNow(new Date(post.created_at), {
    addSuffix: true,
    locale: ko
  })

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow">
        {/* 작성자 정보 및 액션 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white font-semibold text-sm">
                {post.member_profiles?.display_name?.charAt(0) || 'U'}
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <p className="font-medium text-gray-900">
                  {post.member_profiles?.display_name || '알 수 없는 사용자'}
                </p>
                {isAdmin && (
                  <Crown className="w-4 h-4 text-yellow-500" title="관리자" />
                )}
              </div>
              <p className="text-sm text-gray-500">{timeAgo}</p>
            </div>
          </div>

          {isAuthor && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowEditModal(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  수정
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-red-600"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* 게시글 내용 */}
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-3">
            {post.title}
          </h3>
          <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">
            {post.content}
          </div>
        </div>

        {/* 수정 정보 */}
        {post.updated_at !== post.created_at && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(post.updated_at), {
                addSuffix: true,
                locale: ko
              })} 수정됨
            </p>
          </div>
        )}
      </div>

      {/* 수정 모달 */}
      {showEditModal && (
        <EditPostModal
          post={post}
          onSuccess={() => {
            setShowEditModal(false)
            onUpdated()
          }}
          onCancel={() => setShowEditModal(false)}
        />
      )}

      {/* 삭제 다이얼로그 */}
      {showDeleteDialog && (
        <DeletePostDialog
          post={post}
          onSuccess={() => {
            setShowDeleteDialog(false)
            onDeleted()
          }}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </>
  )
}
```

### 4.5 게시글 수정 모달

```typescript
// src/components/board/EditPostModal.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { PostWithAuthor } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'

interface EditPostModalProps {
  post: PostWithAuthor
  onSuccess: () => void
  onCancel: () => void
}

export function EditPostModal({ post, onSuccess, onCancel }: EditPostModalProps) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: post.title,
    content: post.content
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.error('제목과 내용을 모두 입력해주세요.')
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase
        .from('posts')
        .update({
          title: formData.title.trim(),
          content: formData.content.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', post.id)
        .eq('author_id', post.author_id) // 작성자만 수정 가능

      if (error) {
        console.error('Post update error:', error)
        toast.error('게시글 수정 중 오류가 발생했습니다.')
        return
      }

      onSuccess()
    } catch (error) {
      console.error('Post update error:', error)
      toast.error('게시글 수정 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>게시글 수정</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="edit-title">제목</Label>
            <Input
              id="edit-title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="게시글 제목을 입력하세요"
              maxLength={100}
              required
            />
          </div>

          <div>
            <Label htmlFor="edit-content">내용</Label>
            <Textarea
              id="edit-content"
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              placeholder="게시글 내용을 입력하세요"
              rows={8}
              maxLength={5000}
              required
            />
            <p className="text-sm text-gray-500 mt-1">
              {formData.content.length}/5000자
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {loading ? '수정 중...' : '수정 완료'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

## 🔧 Phase 5: 관리자 시스템 구현 (1주)

### 5.1 관리자 대시보드

```typescript
// src/app/admin/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Users, UserCheck, UserX, MessageSquare } from 'lucide-react'

export default function AdminDashboard() {
  const supabase = createClient()

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const [
        { count: totalMembers },
        { count: approvedMembers },
        { count: pendingMembers },
        { count: totalPosts }
      ] = await Promise.all([
        supabase.from('member_profiles').select('*', { count: 'exact', head: true }),
        supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('registration_status', 'approved'),
        supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('registration_status', 'pending'),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('is_deleted', false)
      ])

      return {
        totalMembers: totalMembers || 0,
        approvedMembers: approvedMembers || 0,
        pendingMembers: pendingMembers || 0,
        totalPosts: totalPosts || 0
      }
    }
  })

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">관리자 대시보드</h1>

        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">승인된 조합원</CardTitle>
              <UserCheck className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.approvedMembers}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">승인 대기</CardTitle>
              <UserX className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.pendingMembers}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">총 게시글</CardTitle>
              <MessageSquare className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalPosts}</div>
            </CardContent>
          </Card>
        </div>

        {/* 빠른 액션 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>빠른 액션</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => window.location.href = '/admin/members'}
              >
                <UserCheck className="w-4 h-4 mr-2" />
                조합원 승인 관리
              </Button>
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => window.location.href = '/board'}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                게시판 바로가기
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>최근 활동</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                최근 가입 신청 및 게시글 활동을 확인하세요.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
```

### 5.2 조합원 관리 페이지

```typescript
// src/app/admin/members/page.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MemberProfile } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, X, Eye, Mail, Phone, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'

export default function MemberManagementPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [selectedMember, setSelectedMember] = useState<MemberProfile | null>(null)

  // 조합원 목록 조회
  const { data: members, isLoading } = useQuery({
    queryKey: ['admin-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as MemberProfile[]
    }
  })

  // 조합원 승인
  const approveMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      
      const { error } = await supabase
        .from('member_profiles')
        .update({
          registration_status: 'approved',
          is_active: true,
          approved_at: new Date().toISOString(),
          approved_by: user?.id
        })
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-members'] })
      toast.success('조합원이 승인되었습니다.')
    },
    onError: () => {
      toast.error('승인 처리 중 오류가 발생했습니다.')
    }
  })

  // 조합원 거절
  const rejectMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('member_profiles')
        .update({
          registration_status: 'rejected',
          is_active: false
        })
        .eq('id', memberId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-members'] })
      toast.success('조합원 신청이 거절되었습니다.')
    },
    onError: () => {
      toast.error('거절 처리 중 오류가 발생했습니다.')
    }
  })

  const pendingMembers = members?.filter(m => m.registration_status === 'pending') || []
  const approvedMembers = members?.filter(m => m.registration_status === 'approved') || []
  const rejectedMembers = members?.filter(m => m.registration_status === 'rejected') || []

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800">승인됨</Badge>
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">대기 중</Badge>
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800">거절됨</Badge>
      default:
        return <Badge variant="secondary">알 수 없음</Badge>
    }
  }

  const MemberCard = ({ member }: { member: MemberProfile }) => (
    <Card className="mb-4">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2 flex-1">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold">{member.display_name}</h3>
              {getStatusBadge(member.registration_status)}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
              <div className="flex items-center space-x-2">
                <Mail className="w-4 h-4" />
                <span>{member.email}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Phone className="w-4 h-4" />
                <span>{member.phone_number}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4" />
                <span>가입일: {new Date(member.created_at).toLocaleDateString('ko-KR')}</span>
              </div>
              <div>
                <span>조합비: {member.monthly_fee.toLocaleString()}원/월</span>
              </div>
            </div>
          </div>

          <div className="flex space-x-2 ml-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedMember(member)}
            >
              <Eye className="w-4 h-4 mr-1" />
              상세
            </Button>
            
            {member.registration_status === 'pending' && (
              <>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => approveMutation.mutate(member.id)}
                  disabled={approveMutation.isPending}
                >
                  <Check className="w-4 h-4 mr-1" />
                  승인
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => rejectMutation.mutate(member.id)}
                  disabled={rejectMutation.isPending}
                >
                  <X className="w-4 h-4 mr-1" />
                  거절
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 p-8">로딩 중...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">조합원 관리</h1>

        <Tabs defaultValue="pending" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pending">
              승인 대기 ({pendingMembers.length})
            </TabsTrigger>
            <TabsTrigger value="approved">
              승인됨 ({approvedMembers.length})
            </TabsTrigger>
            <TabsTrigger value="rejected">
              거절됨 ({rejectedMembers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            <div className="space-y-4">
              {pendingMembers.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <p className="text-gray-500">승인 대기 중인 조합원이 없습니다.</p>
                  </CardContent>
                </Card>
              ) : (
                pendingMembers.map(member => (
                  <MemberCard key={member.id} member={member} />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="approved">
            <div className="space-y-4">
              {approvedMembers.map(member => (
                <MemberCard key={member.id} member={member} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="rejected">
            <div className="space-y-4">
              {rejectedMembers.map(member => (
                <MemberCard key={member.id} member={member} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* 상세 정보 모달 */}
      {selectedMember && (
        <MemberDetailModal
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </div>
  )
}

// 조합원 상세 정보 모달
function MemberDetailModal({ 
  member, 
  onClose 
}: { 
  member: MemberProfile
  onClose: () => void 
}) {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{member.display_name} 상세 정보</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 기본 정보 */}
          <div>
            <h4 className="font-semibold mb-3">기본 정보</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">활동명:</span> {member.display_name}
              </div>
              <div>
                <span className="font-medium">실명:</span> {member.real_name}
              </div>
              <div>
                <span className="font-medium">이메일:</span> {member.email}
              </div>
              <div>
                <span className="font-medium">연락처:</span> {member.phone_number}
              </div>
              <div>
                <span className="font-medium">생년월일:</span> {member.birth_date}
              </div>
              <div>
                <span className="font-medium">가입일:</span> {new Date(member.created_at).toLocaleDateString('ko-KR')}
              </div>
            </div>
          </div>

          {/* 조합비 정보 */}
          <div>
            <h4 className="font-semibold mb-3">조합비 정보</h4>
            <div className="text-sm">
              <span className="font-medium">월 조합비:</span> {member.monthly_fee.toLocaleString()}원
            </div>
          </div>

          {/* 계좌 정보 */}
          <div>
            <h4 className="font-semibold mb-3">계좌 정보</h4>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <span className="font-medium">은행:</span> {member.bank_name}
              </div>
              <div>
                <span className="font-medium">계좌번호:</span> {member.account_number}
              </div>
              <div>
                <span className="font-medium">예금주:</span> {member.account_holder}
              </div>
            </div>
          </div>

          {/* 상태 정보 */}
          <div>
            <h4 className="font-semibold mb-3">상태 정보</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">등록 상태:</span> 
                <span className="ml-2">{getStatusBadge(member.registration_status)}</span>
              </div>
              <div>
                <span className="font-medium">활성 상태:</span> 
                <span className={`ml-2 ${member.is_active ? 'text-green-600' : 'text-red-600'}`}>
                  {member.is_active ? '활성' : '비활성'}
                </span>
              </div>
              {member.approved_at && (
                <div className="col-span-2">
                  <span className="font-medium">승인일:</span> {new Date(member.approved_at).toLocaleDateString('ko-KR')}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose}>닫기</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

## 📧 Phase 6: 알림 시스템 구현 (1주)

### 6.1 이메일 알림 서비스 설정

```typescript
// supabase/functions/send-email/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { type, memberId, memberEmail, memberName } = await req.json()

    let subject = ''
    let htmlContent = ''

    switch (type) {
      case 'approval':
        subject = '경기아트콜렉티브 조합원 승인 완료'
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">조합원 승인이 완료되었습니다!</h2>
            <p>안녕하세요 <strong>${memberName}</strong>님,</p>
            <p>경기아트콜렉티브 조합원으로 승인되었습니다.</p>
            <p>이제 조합원 전용 게시판을 이용하실 수 있습니다.</p>
            <div style="margin: 30px 0;">
              <a href="${Deno.env.get('SITE_URL')}/board" 
                 style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">
                게시판 바로가기
              </a>
            </div>
            <p>감사합니다.</p>
            <p>경기아트콜렉티브 운영팀</p>
          </div>
        `
        break

      case 'rejection':
        subject = '경기아트콜렉티브 조합원 신청 결과'
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc2626;">조합원 신청 검토 결과</h2>
            <p>안녕하세요 <strong>${memberName}</strong>님,</p>
            <p>조합원 신청을 검토한 결과, 현재로서는 승인이 어려운 상황입니다.</p>
            <p>추가 문의사항이 있으시면 언제든 연락주시기 바랍니다.</p>
            <p>감사합니다.</p>
            <p>경기아트콜렉티브 운영팀</p>
          </div>
        `
        break

      default:
        return new Response('Invalid email type', { status: 400 })
    }

    // Resend API로 이메일 발송
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'no-reply@ggac.co.kr',
        to: memberEmail,
        subject: subject,
        html: htmlContent
      })
    })

    if (!emailResponse.ok) {
      throw new Error('Failed to send email')
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Email sending error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
```

### 6.2 실시간 알림 시스템

```typescript
// src/hooks/useRealTimeNotifications.ts
'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

export function useRealTimeNotifications(userId: string) {
  const supabase = createClient()

  useEffect(() => {
    if (!userId) return

    // 새 게시글 알림
    const postsChannel = supabase
      .channel('new-posts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
          filter: `author_id=neq.${userId}` // 자신이 작성한 글 제외
        },
        (payload) => {
          toast.success(`새 게시글: ${payload.new.title}`, {
            duration: 4000,
            position: 'top-right'
          })
        }
      )
      .subscribe()

    // 조합원 승인 상태 변경 알림
    const memberChannel = supabase
      .channel('member-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'member_profiles',
          filter: `id=eq.${userId}`
        },
        (payload) => {
          if (payload.new.registration_status === 'approved') {
            toast.success('조합원 승인이 완료되었습니다! 게시판을 이용하실 수 있습니다.', {
              duration: 6000,
              position: 'top-center'
            })
            // 페이지 새로고침으로 권한 적용
            setTimeout(() => window.location.reload(), 2000)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(postsChannel)
      supabase.removeChannel(memberChannel)
    }
  }, [userId, supabase])
}
```

## 🎨 Phase 7: UI/UX 개선 및 모바일 최적화 (1-2주)

### 7.1 공통 컴포넌트 라이브러리

```typescript
// src/components/ui/button.tsx
import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  size?: 'default' | 'sm' | 'lg'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background',
          {
            'bg-primary text-primary-foreground hover:bg-primary/90': variant === 'default',
            'bg-destructive text-destructive-foreground hover:bg-destructive/90': variant === 'destructive',
            'border border-input hover:bg-accent hover:text-accent-foreground': variant === 'outline',
            'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
            'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
          },
          {
            'h-10 py-2 px-4': size === 'default',
            'h-9 px-3 rounded-md': size === 'sm',
            'h-11 px-8 rounded-md': size === 'lg',
          },
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'
export { Button }
```

### 7.2 반응형 헤더 컴포넌트

```typescript
// src/components/board/BoardHeader.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Plus, Menu, X, LogOut, User, Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface BoardHeaderProps {
  user: any
  onCreatePost: () => void
}

export function BoardHeader({ user, onCreatePost }: BoardHeaderProps) {
  const supabase = createClient()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* 로고 및 제목 */}
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-900">
              경기아트콜렉티브
            </h1>
            <span className="ml-2 text-sm text-gray-500 hidden sm:inline">
              조합원 게시판
            </span>
          </div>

          {/* 데스크톱 네비게이션 */}
          <div className="hidden md:flex items-center space-x-4">
            <Button
              onClick={onCreatePost}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              게시글 작성
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center space-x-2">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="text-sm">{user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem>
                  <User className="w-4 h-4 mr-2" />
                  프로필
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="w-4 h-4 mr-2" />
                  설정
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 모바일 메뉴 버튼 */}
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>

        {/* 모바일 메뉴 */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 py-4">
            <div className="space-y-3">
              <Button
                onClick={() => {
                  onCreatePost()
                  setMobileMenuOpen(false)
                }}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                게시글 작성
              </Button>
              
              <div className="pt-3 border-t border-gray-200">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium">{user?.email}</span>
                </div>
                
                <div className="space-y-2">
                  <Button variant="ghost" className="w-full justify-start">
                    <User className="w-4 h-4 mr-2" />
                    프로필
                  </Button>
                  <Button variant="ghost" className="w-full justify-start">
                    <Settings className="w-4 h-4 mr-2" />
                    설정
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start text-red-600"
                    onClick={handleLogout}
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    로그아웃
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
```

### 7.3 PWA 설정

```json
// public/manifest.json
{
  "name": "경기아트콜렉티브 조합원 게시판",
  "short_name": "GGAC Board",
  "description": "경기아트콜렉티브 조합원 전용 커뮤니티 플랫폼",
  "start_url": "/board",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "orientation": "portrait-primary-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">전체 조합원</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalMembers}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="display_name">조합원 이름 또는 활동명 *</Label>
                  <Input
                    id="display_name"
                    value={formData.display_name}
                    onChange={(e) => handleInputChange('display_name', e.target.value)}
                    placeholder="홍길동 또는 작가명"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="phone_number">연락처 *</Label>
                  <Input
                    id="phone_number"
                    value={formData.phone_number}
                    onChange={(e) => {
                      let value = e.target.value.replace(/[^0-9]/g, '')
                      if (value.length >= 4) {
                        if (value.length <= 7) {
                          value = value.replace(/(\d{3})(\d+)/, '$1-$2')
                        } else {
                          value = value.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')
                        }
                      }
                      handleInputChange('phone_number', value)
                    }}
                    placeholder="010-1234-5678"
                    maxLength={13}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="birth_date">생년월일 (주민등록상) *</Label>
                  <Input
                    id="birth_date"
                    type="date"
                    value={formData.birth_date}
                    onChange={(e) => handleInputChange('birth_date', e.target.value)}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="real_name">실명 (예금주와 동일) *</Label>
                  <Input
                    id="real_name"
                    value={formData.real_name}
                    onChange={(e) => handleInputChange('real_name', e.target.value)}
                    placeholder="주민등록상 실명"
                    required
                  />
                </div>
              </div>
            </div>

            {/* 조합비 섹션 */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold border-b pb-2">조합비 정보</h3>
              
              <div>
                <Label htmlFor="monthly_fee">월 조합비 *</Label>
                <Select 
                  value={formData.monthly_fee.toString()} 
                  onValueChange={(value) => handleInputChange('monthly_fee', parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="조합비를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {monthlyFeeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500 mt-1">
                  조합비는 조합 운영 및 활동 지원에 사용됩니다.
                </p>
              </div>
            </div>

            {/* 계좌정보 섹션 */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold border-b pb-2">계좌 정보</h3>
              
              <div className="grid grid-cols