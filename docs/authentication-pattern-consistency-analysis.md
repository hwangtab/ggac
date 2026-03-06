# API 인증 패턴 일관성 분석 및 개선 계획

## 📋 분석 개요

본 문서는 경기아트콜렉티브 협동조합 웹사이트의 전체 API 라이브러리에서 발견된
인증 패턴 불일치 문제를 종합적으로 분석하고, 체계적인 개선 계획을 제시합니다.

**분석 날짜**: 2025년 1월 31일  
**분석 대상**: 38개 API 라우트 파일  
**분석 도구**: Gemini CLI를 통한 전체 코드베이스 스캔  
**근본 문제**: `/api/admin/artists/[id]/members/route.ts`에서 발견된 401 인증
오류의 원인 분석을 통해 전체 시스템의 인증 패턴 불일치 발견

---

## 🔍 발견된 인증 패턴 분류

### Pattern A: `createRouteHandlerClient` + `getUser()` 방식

**사용 빈도**: 25개 API (전체의 66%)

#### 코드 패턴:

```typescript
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 관리자 권한 확인
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('is_admin')
    .eq('id', user.id) // user.id 사용
    .single()
}
```

#### 사용하는 API 목록:

**게시판 관련 API (6개)**

- `/api/posts/[id]/attachments/route.ts`
- `/api/posts/[id]/likes/route.ts`
- `/api/posts/[id]/route.ts`
- `/api/posts/[id]/view/route.ts`
- `/api/posts/[id]/attachments/[attachmentId]/route.ts`
- `/api/comments/[id]/like/route.ts`

**관리자 API - 활동 및 분석 (4개)**

- `/api/admin/activities/real-time/route.ts`
- `/api/admin/activities/users/route.ts`
- `/api/admin/analytics/patterns/route.ts`
- `/api/admin/analytics/trends/route.ts`

**관리자 API - 멤버 관리 (3개)**

- `/api/admin/member-action/route.ts`
- `/api/admin/members/advanced-search/route.ts`
- `/api/admin/performance/route.ts`

**관리자 API - 게시글 관리 (4개)**

- `/api/admin/posts/advanced-search/route.ts`
- `/api/admin/posts/route.ts`
- `/api/admin/posts/stats/route.ts`
- `/api/admin/posts/[id]/route.ts`

**관리자 API - 기타 (8개)**

- `/api/admin/reports/generate/route.ts`
- `/api/users/[id]/likes/route.ts`
- `/api/auth/verify-session/route.ts`
- `/api/images/route.ts`
- `/api/mypage/activity/route.ts`
- `/api/notifications/route.ts`
- `/api/notifications/[id]/route.ts`
- `/api/settings/route.ts`

### Pattern B: `createServerComponentClient` + `getSession()` 방식 ✅

**사용 빈도**: 13개 API (전체의 34%)

#### 코드 패턴:

```typescript
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const supabase = createServerComponentClient({ cookies: () => cookieStore })

  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession()

  if (authError || !session?.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  // 관리자 권한 확인
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('is_admin, registration_status, is_active')
    .eq('id', session.user.id) // session.user.id 사용
    .single()
}
```

#### 사용하는 API 목록:

**관리자 API - 멤버 관리 (4개)**

- `/api/admin/members/route.ts`
- `/api/admin/members/bulk/route.ts`
- `/api/admin/members/stats/route.ts`
- `/api/admin/members/[id]/route.ts`

**관리자 API - 아티스트 관리 (4개)**

- `/api/admin/artists/route.ts`
- `/api/admin/artists/members/route.ts`
- `/api/admin/artists/[id]/members/route.ts` ✅ **최근 수정 완료**
- `/api/admin/artists/[id]/members/[memberId]/route.ts`

**관리자 API - 설정 및 통계 (4개)**

- `/api/admin/settings/route.ts`
- `/api/admin/settings/backup/route.ts`
- `/api/admin/settings/cache/route.ts`
- `/api/admin/settings/reset/route.ts`

**관리자 API - 통계 (1개)**

- `/api/admin/stats/route.ts`
- `/api/admin/stats/monthly/route.ts`

### Pattern C: 복잡한 토큰 추출 방식 ❌

**사용 빈도**: 0개 (최근 수정으로 제거됨)

이전에 `/api/admin/artists/[id]/members/route.ts`에서 사용되던 복잡한 인증
방식은 2025년 1월 31일 수정으로 완전히 제거되었습니다.

---

## 🚨 문제점 상세 분석

### 1. 기술적 차이점

#### `createRouteHandlerClient` vs `createServerComponentClient`

| 측면          | createRouteHandlerClient | createServerComponentClient |
| ------------- | ------------------------ | --------------------------- |
| **주 용도**   | API 라우트 핸들러        | 서버 컴포넌트, API 라우트   |
| **쿠키 처리** | 자동 쿠키 처리           | 명시적 쿠키 제공 필요       |
| **세션 관리** | `getUser()` 메서드       | `getSession()` 메서드       |
| **에러 처리** | 토큰 만료 시 null 반환   | 세션 만료 시 명확한 에러    |
| **일관성**    | 상대적으로 불안정        | 더 안정적이고 예측 가능     |

#### `getUser()` vs `getSession()`

| 메서드         | 장점             | 단점                | 잠재적 문제                   |
| -------------- | ---------------- | ------------------- | ----------------------------- |
| `getUser()`    | 간단한 사용법    | 세션 상태 불명확    | 토큰 만료 시 예상치 못한 null |
| `getSession()` | 완전한 세션 정보 | 약간 더 복잡한 구조 | 거의 없음 (권장)              |

### 2. 실제 발생 가능한 문제들

#### A. 인증 실패 시나리오

1. **토큰 만료 처리 차이**: `getUser()`는 만료된 토큰에 대해 불일치한 동작
2. **쿠키 처리 방식 차이**: 서로 다른 클라이언트 생성 방식으로 인한 쿠키 접근
   방식 차이
3. **에러 메시지 불일치**: 인증 실패 시 서로 다른 에러 응답

#### B. 개발 및 유지보수 문제

1. **패턴 혼재로 인한 혼란**: 새로운 API 개발 시 어떤 패턴을 사용할지 불명확
2. **버그 수정의 일관성 부족**: 인증 관련 버그 발견 시 모든 패턴에 동일하게 적용
   필요
3. **코드 리뷰 복잡성**: 리뷰어가 여러 패턴을 모두 숙지해야 함

#### C. 보안 취약점

1. **인증 우회 가능성**: 서로 다른 인증 검증 로직으로 인한 보안 허점
2. **세션 관리 불일치**: 로그아웃 후에도 일부 API에서 접근 가능한 경우 발생 가능

---

## 📊 영향도 분석

### 중요도별 API 분류

#### 🔴 고위험 (즉시 수정 필요)

**관리자 API (15개)**

- 사용자 데이터 관리, 시스템 설정 변경 등 민감한 작업 수행
- 현재 Pattern A 사용으로 인증 불일치 위험 높음

**주요 대상**:

- `/api/admin/members/advanced-search/route.ts`
- `/api/admin/posts/route.ts`
- `/api/admin/reports/generate/route.ts`
- `/api/admin/performance/route.ts`
- 기타 11개 관리자 API

#### 🟡 중위험 (우선 수정 권장)

**게시판 상호작용 API (6개)**

- 사용자 콘텐츠 조작, 좋아요, 댓글 등
- 사용 빈도 높아 안정성 중요

**주요 대상**:

- `/api/posts/[id]/likes/route.ts`
- `/api/posts/[id]/route.ts`
- `/api/comments/[id]/like/route.ts`
- 기타 3개 게시판 API

#### 🟢 저위험 (장기 계획으로 수정)

**기타 API (4개)**

- 상대적으로 덜 민감한 작업
- 현재 동작에 큰 문제 없음

**주요 대상**:

- `/api/users/[id]/likes/route.ts`
- `/api/notifications/route.ts`
- `/api/images/route.ts`
- `/api/settings/route.ts`

---

## 🎯 체계적 개선 계획

### Phase 1: 고위험 관리자 API 수정 (1-2주)

#### 1.1 준비 작업

- [ ] 관리자 API 백업 및 롤백 계획 수립
- [ ] 테스트 시나리오 작성 (각 API별 인증 테스트)
- [ ] 스테이징 환경에서 먼저 적용

#### 1.2 수정 대상 API (15개)

```
우선순위 1 (5개 - 1주차):
├── /api/admin/members/advanced-search/route.ts
├── /api/admin/posts/route.ts
├── /api/admin/posts/stats/route.ts
├── /api/admin/posts/[id]/route.ts
└── /api/admin/performance/route.ts

우선순위 2 (5개 - 2주차):
├── /api/admin/activities/real-time/route.ts
├── /api/admin/activities/users/route.ts
├── /api/admin/analytics/patterns/route.ts
├── /api/admin/analytics/trends/route.ts
└── /api/admin/member-action/route.ts

우선순위 3 (5개 - 2주차):
├── /api/admin/reports/generate/route.ts
├── /api/admin/posts/advanced-search/route.ts
├── /api/users/[id]/likes/route.ts
├── /api/auth/verify-session/route.ts
└── /api/mypage/activity/route.ts
```

#### 1.3 수정 작업 체크리스트

각 API 파일에 대해 다음 작업 수행:

**1. Import 구문 변경**

```typescript
// Before
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

// After
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
```

**2. 클라이언트 생성 로직 변경**

```typescript
// Before
const supabase = createRouteHandlerClient({ cookies })

// After
const cookieStore = cookies()
const supabase = createServerComponentClient({ cookies: () => cookieStore })
```

**3. 인증 확인 로직 변경**

```typescript
// Before
const {
  data: { user },
} = await supabase.auth.getUser()
if (!user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// After
const {
  data: { session },
  error: authError,
} = await supabase.auth.getSession()
if (authError || !session?.user) {
  return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
}
```

**4. 사용자 ID 참조 변경**

```typescript
// Before: 모든 user.id 발생 지점
user.id

// After: session.user.id로 변경
session.user.id
```

**5. 에러 처리 통일**

- 한국어 에러 메시지로 일관성 확보
- 401, 403, 500 에러 응답 표준화

### Phase 2: 중위험 게시판 API 수정 (2-3주)

#### 2.1 수정 대상 API (6개)

```
게시판 핵심 기능 (3개):
├── /api/posts/[id]/route.ts
├── /api/posts/[id]/likes/route.ts
└── /api/comments/[id]/like/route.ts

게시판 부가 기능 (3개):
├── /api/posts/[id]/attachments/route.ts
├── /api/posts/[id]/view/route.ts
└── /api/posts/[id]/attachments/[attachmentId]/route.ts
```

#### 2.2 특별 고려사항

- **높은 사용 빈도**: 사용자들이 가장 많이 사용하는 API들
- **실시간 테스트 필수**: 수정 후 즉시 기능 테스트 필요
- **롤백 준비**: 문제 발생 시 즉시 이전 버전으로 복구

### Phase 3: 저위험 기타 API 수정 (3-4주)

#### 3.1 수정 대상 API (4개)

```
기타 API:
├── /api/notifications/route.ts
├── /api/notifications/[id]/route.ts
├── /api/images/route.ts
└── /api/settings/route.ts
```

#### 3.2 수정 방식

- 상대적으로 여유있는 일정으로 진행
- 앞서 수정된 패턴을 템플릿으로 활용
- 전체 시스템 안정성 확인 후 진행

---

## 🧪 테스트 계획

### 단위 테스트 (각 API별)

#### 인증 시나리오 테스트

```javascript
// 테스트 시나리오 예시
describe('API Authentication Tests', () => {
  test('Valid session - should return 200', async () => {
    // 유효한 세션으로 API 호출
    // 예상: 200 응답
  })

  test('Invalid session - should return 401', async () => {
    // 무효한 세션으로 API 호출
    // 예상: 401 응답
  })

  test('Expired session - should return 401', async () => {
    // 만료된 세션으로 API 호출
    // 예상: 401 응답
  })

  test('No session - should return 401', async () => {
    // 세션 없이 API 호출
    // 예상: 401 응답
  })
})
```

### 통합 테스트

#### API 간 일관성 테스트

```javascript
// 모든 API가 동일한 세션에 대해 일관된 응답을 하는지 확인
const testConsistency = async () => {
  const session = await getTestSession()

  const apis = [
    '/api/admin/members',
    '/api/admin/posts',
    '/api/posts/[id]/likes',
    // 모든 수정된 API들
  ]

  for (const api of apis) {
    const response = await testAuth(api, session)
    expect(response.authBehavior).toBe('consistent')
  }
}
```

### 성능 테스트

#### 인증 처리 성능 비교

- 수정 전 vs 수정 후 응답 시간 측정
- 동시 요청 처리 능력 확인
- 메모리 사용량 분석

---

## 📈 모니터링 계획

### 실시간 모니터링 지표

#### 1. 인증 성공률

```javascript
// 모니터링 메트릭 예시
{
  "auth_success_rate": "99.8%",
  "auth_failure_breakdown": {
    "401_unauthorized": "0.1%",
    "403_forbidden": "0.1%",
    "500_server_error": "0.0%"
  }
}
```

#### 2. API 응답 시간

- 인증 처리 시간: < 100ms 목표
- 전체 API 응답 시간: < 500ms 목표

#### 3. 에러 발생 패턴

- 특정 시간대별 인증 실패율
- 사용자별 인증 실패 패턴
- API별 에러 발생 빈도

### 알림 체계

#### 즉시 알림 (Critical)

- 인증 성공률 95% 이하로 떨어질 때
- 특정 API에서 5분간 연속 500 에러 발생 시

#### 일일 리포트 (Warning)

- 인증 실패율 증가 추세
- 새로운 에러 패턴 발견

---

## 🔧 구현 가이드라인

### 코드 표준화

#### 1. 표준 인증 템플릿

```typescript
// /docs/templates/standard-auth-pattern.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'

export async function [METHOD](request: NextRequest) {
  try {
    // 1. Supabase 클라이언트 생성
    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 2. 세션 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    // 3. 권한 확인 (필요한 경우)
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json(
        { error: '프로필 정보를 조회할 수 없습니다.' },
        { status: 500 }
      )
    }

    // 4. 관리자 권한 확인 (관리자 API인 경우)
    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '관리자 권한이 필요합니다.' },
        { status: 403 }
      )
    }

    // 5. 실제 비즈니스 로직
    // ...

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
```

#### 2. 에러 응답 표준화

```typescript
// /src/utils/authResponses.ts
export const AuthResponses = {
  UNAUTHORIZED: NextResponse.json(
    { error: '인증이 필요합니다.' },
    { status: 401 }
  ),

  FORBIDDEN: NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 }),

  ADMIN_REQUIRED: NextResponse.json(
    { error: '관리자 권한이 필요합니다.' },
    { status: 403 }
  ),

  PROFILE_ERROR: NextResponse.json(
    { error: '프로필 정보를 조회할 수 없습니다.' },
    { status: 500 }
  ),

  SERVER_ERROR: NextResponse.json(
    { error: '서버 오류가 발생했습니다.' },
    { status: 500 }
  ),
}
```

### 코드리뷰 체크리스트

#### 새로운 API 개발 시

- [ ] `createServerComponentClient` 사용 확인
- [ ] `getSession()` 메서드 사용 확인
- [ ] `session.user.id` 형태로 사용자 ID 참조 확인
- [ ] 표준 에러 응답 사용 확인
- [ ] 적절한 권한 확인 로직 구현 확인

#### 기존 API 수정 시

- [ ] 인증 패턴 일관성 유지 확인
- [ ] 기존 기능 동작 영향 없음 확인
- [ ] 에러 처리 로직 개선 확인

---

## 📋 실행 일정표

### 상세 주별 계획

#### 1주차: 프로젝트 준비 및 고위험 API 수정 시작

**월요일-화요일: 준비 작업**

- [ ] 백업 및 롤백 계획 수립
- [ ] 테스트 환경 구성
- [ ] 표준 템플릿 작성

**수요일-금요일: 고위험 API 수정 (5개)**

- [ ] `/api/admin/members/advanced-search/route.ts`
- [ ] `/api/admin/posts/route.ts`
- [ ] `/api/admin/posts/stats/route.ts`
- [ ] `/api/admin/posts/[id]/route.ts`
- [ ] `/api/admin/performance/route.ts`

#### 2주차: 고위험 API 수정 완료 및 테스트

**월요일-수요일: 나머지 고위험 API 수정 (10개)**

- [ ] 활동/분석 API 4개 수정
- [ ] 멤버 관리 API 수정
- [ ] 리포트 및 기타 API 5개 수정

**목요일-금요일: 통합 테스트**

- [ ] 수정된 모든 관리자 API 테스트
- [ ] 인증 시나리오별 검증
- [ ] 성능 비교 분석

#### 3주차: 중위험 게시판 API 수정

**월요일-화요일: 핵심 게시판 API (3개)**

- [ ] `/api/posts/[id]/route.ts`
- [ ] `/api/posts/[id]/likes/route.ts`
- [ ] `/api/comments/[id]/like/route.ts`

**수요일-목요일: 부가 게시판 API (3개)**

- [ ] `/api/posts/[id]/attachments/route.ts`
- [ ] `/api/posts/[id]/view/route.ts`
- [ ] `/api/posts/[id]/attachments/[attachmentId]/route.ts`

**금요일: 게시판 기능 테스트**

- [ ] 사용자 관점에서 전체 게시판 기능 테스트
- [ ] 좋아요, 댓글, 첨부파일 등 상호작용 테스트

#### 4주차: 저위험 API 수정 및 최종 검증

**월요일-화요일: 기타 API 수정 (4개)**

- [ ] `/api/notifications/route.ts`
- [ ] `/api/notifications/[id]/route.ts`
- [ ] `/api/images/route.ts`
- [ ] `/api/settings/route.ts`

**수요일-목요일: 전체 시스템 테스트**

- [ ] 모든 API 인증 일관성 검증
- [ ] 사용자 플로우별 전체 테스트
- [ ] 성능 및 안정성 최종 확인

**금요일: 문서화 및 마무리**

- [ ] 개선 결과 문서 작성
- [ ] 개발팀 가이드라인 업데이트
- [ ] 모니터링 대시보드 구성

---

## 📊 성공 지표

### 정량적 지표

#### 1. 인증 관련 지표

- **인증 성공률**: 99.5% 이상 유지
- **401 에러 발생률**: 현재 대비 50% 감소
- **API 응답 시간**: 인증 처리 시간 < 50ms

#### 2. 코드 품질 지표

- **인증 패턴 일관성**: 100% (모든 API가 동일한 패턴 사용)
- **코드 중복 제거**: 인증 로직 코드 라인 20% 감소
- **테스트 커버리지**: 인증 관련 코드 90% 이상

#### 3. 개발 효율성 지표

- **새 API 개발 시간**: 인증 구현 시간 50% 단축
- **버그 수정 시간**: 인증 관련 버그 수정 시간 30% 단축

### 정성적 지표

#### 1. 개발자 경험

- 명확한 인증 패턴으로 혼란 제거
- 코드리뷰 시간 단축
- 신규 개발자 온보딩 시간 단축

#### 2. 사용자 경험

- 인증 실패로 인한 예상치 못한 로그아웃 감소
- 일관된 에러 메시지로 사용자 이해도 향상

#### 3. 시스템 안정성

- 인증 관련 장애 발생 빈도 감소
- 보안 취약점 사전 방지

---

## 🚨 위험 요소 및 대응 방안

### 높은 위험도

#### 1. 서비스 중단 위험

**위험**: API 수정 중 예상치 못한 오류로 서비스 중단

**대응방안**:

- 스테이징 환경에서 충분한 테스트 후 프로덕션 적용
- 즉시 롤백 가능한 배포 전략 수립
- 수정 작업을 낮은 트래픽 시간대에 수행
- 실시간 모니터링으로 문제 조기 발견

#### 2. 인증 우회 취약점

**위험**: 수정 과정에서 실수로 인증 검사 누락

**대응방안**:

- 모든 수정사항에 대한 코드리뷰 필수
- 자동화된 보안 테스트 구축
- 인증 우회 시나리오별 테스트 케이스 작성

### 중간 위험도

#### 3. 사용자 세션 문제

**위험**: 기존 로그인 사용자의 세션 호환성 문제

**대응방안**:

- 세션 구조 변경 최소화
- 기존 세션 데이터와 호환되는 방식으로 수정
- 필요시 사용자에게 재로그인 안내

#### 4. 성능 저하

**위험**: 새로운 인증 방식으로 인한 성능 저하

**대응방안**:

- 수정 전후 성능 비교 테스트
- 병목 구간 사전 식별 및 최적화
- 캐싱 전략 검토 및 개선

### 낮은 위험도

#### 5. 에러 메시지 변경에 따른 프론트엔드 영향

**위험**: 에러 메시지 표준화로 인한 UI 깨짐

**대응방안**:

- 프론트엔드 팀과 에러 메시지 포맷 협의
- 점진적 적용으로 영향 최소화

---

## 📝 완료 후 추가 개선 사항

### 장기 개선 계획

#### 1. 인증 미들웨어 도입

현재 각 API마다 인증 로직을 반복 구현하고 있는 상황을 개선하기 위해 인증
미들웨어 도입 검토

```typescript
// 예시: 인증 미들웨어
export const withAuth = (handler: NextApiHandler) => {
  return async (req: NextRequest, res: NextResponse) => {
    // 공통 인증 로직
    const authResult = await authenticateUser(req)
    if (!authResult.success) {
      return authResult.response
    }

    // 인증 성공 시 원래 핸들러 실행
    return handler(req, res, authResult.user)
  }
}
```

#### 2. 권한 기반 접근 제어 (RBAC) 강화

현재의 단순한 관리자/일반 사용자 구분을 더 세분화된 권한 시스템으로 발전

#### 3. API 사용량 모니터링 및 최적화

인증 처리 과정의 성능 데이터를 수집하여 지속적인 최적화

### 코드 품질 개선

#### 1. TypeScript 타입 안전성 강화

인증 관련 타입 정의를 더욱 엄격하게 하여 컴파일 타임에 오류 방지

#### 2. 단위 테스트 확대

각 인증 시나리오에 대한 자동화된 테스트 케이스 확충

#### 3. 문서화 개선

API 문서에 인증 방식 및 에러 코드 상세 설명 추가

---

## 📞 연락처 및 지원

### 프로젝트 담당자

- **주 개발자**: Claude Code Assistant
- **기술 검토**: 개발팀 전체
- **최종 승인**: 프로젝트 매니저

### 문제 발생 시 대응

1. **긴급 상황**: 즉시 롤백 후 원인 분석
2. **일반 문제**: GitHub Issues를 통한 문제 추적
3. **개선 제안**: 정기 코드리뷰 미팅에서 논의

---

**마지막 업데이트**: 2025년 1월 31일  
**문서 버전**: 1.0  
**다음 리뷰 예정일**: 2025년 2월 28일 (프로젝트 완료 후)
