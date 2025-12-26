# 경기아트콜렉티브 웹사이트 코드 리뷰

**작성일**: 2025-12-26  
**리뷰 대상**: GGAC 웹사이트 전체 코드베이스

---

## 📊 프로젝트 개요

| 항목              | 현황                               |
| ----------------- | ---------------------------------- |
| **Framework**     | Next.js 15.5.9, React 19           |
| **Backend**       | Supabase (Auth, Database, Storage) |
| **Styling**       | TailwindCSS 3.4                    |
| **Components**    | 54개 (src/components)              |
| **Hooks**         | 15개 (src/hooks)                   |
| **Utils**         | 36개 (src/utils)                   |
| **API Endpoints** | 72+ (23개 카테고리)                |
| **App Routes**    | 16개 페이지 디렉토리               |

---

## 🔴 우선 개선 필요 (Critical)

### 1. LiquidMetalParticles.tsx - 과도한 파일 크기

**위치**:
[LiquidMetalParticles.tsx](file:///Users/hwang-gyeongha/ggac/src/components/LiquidMetalParticles.tsx)

**문제점**:

- 1,883줄, 73KB의 단일 컴포넌트
- WebGL 셰이더 코드가 컴포넌트 내에 하드코딩됨
- 유지보수 및 테스트가 어려움

**권장사항**:

```
src/components/particles/
├── LiquidMetalParticles.tsx    # 메인 컴포넌트 (~300줄)
├── shaders/
│   ├── update.vert.glsl
│   ├── update.frag.glsl
│   ├── render.vert.glsl
│   └── render.frag.glsl
├── utils/
│   ├── webglHelpers.ts
│   └── particlePhysics.ts
└── types.ts
```

---

### 2. types/index.ts - 단일 파일에 모든 타입 정의

**위치**: [types/index.ts](file:///Users/hwang-gyeongha/ggac/src/types/index.ts)

**문제점**:

- 2,423줄의 단일 타입 파일
- 관련 없는 타입들이 혼재
- 코드 탐색 어려움

**권장사항**:

```
src/types/
├── index.ts              # Re-exports
├── artist.ts             # Artist 관련 타입
├── project.ts            # Project 관련 타입
├── notification.ts       # 알림 관련 타입
├── filter.ts             # 필터링 관련 타입
├── settings.ts           # 설정 관련 타입
├── media.ts              # 미디어/업로드 관련 타입
└── api.ts                # API 응답 타입
```

---

### 3. middleware.ts - 복잡한 라우팅 로직

**위치**: [middleware.ts](file:///Users/hwang-gyeongha/ggac/src/middleware.ts)

**문제점**:

- 524줄의 복잡한 미들웨어
- 인증, 유지보수 모드, 권한 체크가 하나의 함수에 혼재
- 테스트 어려움

**권장사항**:

```typescript
// middleware/index.ts
import { chain } from './chain'
import { withAuth } from './auth'
import { withMaintenance } from './maintenance'
import { withRoles } from './roles'

export default chain([withMaintenance, withAuth, withRoles])
```

---

## 🟠 개선 권장 (Important)

### 4. 중복된 Supabase 클라이언트 초기화

**문제점**:

- 여러 파일에서 `createClient` 호출
- 일관성 없는 클라이언트 사용

**권장사항**:

```typescript
// lib/supabase/server.ts - 서버용 단일 진입점
// lib/supabase/client.ts - 클라이언트용 단일 진입점
```

---

### 5. OptimizedImage.tsx - 과도한 복잡성

**위치**:
[OptimizedImage.tsx](file:///Users/hwang-gyeongha/ggac/src/components/OptimizedImage.tsx)

**문제점**:

- 500줄의 이미지 컴포넌트
- 네트워크 품질 감지, 폴링, 타임아웃, 재시도 로직이 혼재
- fallback 로직이 복잡함

**권장사항**:

```
src/components/image/
├── OptimizedImage.tsx        # 메인 컴포넌트 (~100줄)
├── hooks/
│   ├── useImageLoader.ts     # 로딩 상태 관리
│   ├── useNetworkQuality.ts  # 네트워크 감지
│   └── useFallback.ts        # Fallback 로직
└── utils/
    └── imageHelpers.ts       # 유틸리티 함수
```

---

### 6. CSS-in-JS 스크립트 가드 (layout.tsx)

**위치**:
[layout.tsx:97-128](file:///Users/hwang-gyeongha/ggac/src/app/layout.tsx#L97-128)

**문제점**:

- CSS가 스크립트로 잘못 로드되는 문제를 런타임에서 처리
- 근본 원인을 해결하지 않은 임시 해결책

**권장사항**:

- Next.js 버전 업그레이드 검토
- `next.config.js`의 `optimizeCss` 설정 재검토
- Vercel 배포 설정 확인

---

### 7. 불필요한 의존성

**위치**: [package.json](file:///Users/hwang-gyeongha/ggac/package.json)

**의심되는 패키지**:

- `claude: ^0.1.1` - 사용되지 않는 것으로 보임
- `@tailwindcss/line-clamp: ^0.4.4` - TailwindCSS 3.3+에서 내장됨

**권장사항**:

```bash
npm uninstall claude @tailwindcss/line-clamp
```

---

## 🟡 개선 제안 (Nice to Have)

### 8. API 라우트 구조 개선

**현재 구조**: 72+ API 엔드포인트가 평면 구조

**권장사항**:

```
src/app/api/
├── v1/                       # API 버전 관리
│   ├── posts/
│   ├── users/
│   └── notifications/
├── webhooks/
├── admin/
└── auth/
```

---

### 9. 커스텀 훅 활용도 향상

**현재**: 15개의 훅이 있지만 활용이 제한적

**권장사항**:

- `useLoadingState.ts` (12,805 bytes) - 컴포넌트에서 더 적극 활용
- `usePerformanceMonitor.ts` (12,795 bytes) - 개발 환경에서만 활성화

---

### 10. 환경변수 관리

**문제점**:

- `.env`, `.env.local`, `.env.example` 파일 존재
- 환경별 설정이 명확하지 않음

**권장사항**:

```
.env.development.local
.env.production.local
.env.example  # 템플릿
```

---

## ✅ 잘 구현된 부분

### 1. 보안 설정 (next.config.js)

- 포괄적인 CSP 헤더 설정
- HSTS, X-Frame-Options 등 보안 헤더
- 환경별 분리된 보안 정책

### 2. 이미지 최적화 파이프라인

- WebP 변환 자동화 (pre-commit hook)
- 이미지 검증 스크립트
- Next.js Image 최적화 설정

### 3. 접근성 (Accessibility)

- Skip links 구현
- ARIA 속성 적용
- 키보드 내비게이션 지원

### 4. 타입 안전성

- 포괄적인 TypeScript 타입 정의
- Zod를 활용한 런타임 검증
- API 응답 타입 일관성

### 5. 성능 모니터링

- `PerformanceMonitor.tsx` 컴포넌트
- `useRenderPerformance` 훅
- 에러 트래킹 시스템

---

## 📋 개선 우선순위 요약

| 순위 | 항목                      | 난이도 | 영향도 |
| ---- | ------------------------- | ------ | ------ |
| 1    | LiquidMetalParticles 분리 | 높음   | 높음   |
| 2    | types/index.ts 분리       | 중간   | 높음   |
| 3    | middleware.ts 리팩토링    | 높음   | 중간   |
| 4    | OptimizedImage 리팩토링   | 중간   | 중간   |
| 5    | 불필요한 의존성 제거      | 낮음   | 낮음   |

---

## 🛠️ 즉시 적용 가능한 개선

### 1. 불필요한 패키지 제거

```bash
npm uninstall claude @tailwindcss/line-clamp
```

### 2. 타입 파일 분리 시작

```bash
# types 디렉토리에 모듈별 파일 생성
touch src/types/{artist,project,notification,filter,settings,media,api}.ts
```

### 3. 코드 품질 도구 설정 강화

```json
// .eslintrc.json에 추가
{
  "rules": {
    "max-lines": ["warn", { "max": 500 }],
    "max-lines-per-function": ["warn", { "max": 100 }]
  }
}
```

---

## 📚 참고 자료

- [Next.js 15 문서](https://nextjs.org/docs)
- [React 19 새로운 기능](https://react.dev/blog)
- [Supabase 모범 사례](https://supabase.com/docs/guides/best-practices)

---

## ✅ 완료된 개선 사항 (2025-12-26)

### 1. 불필요한 의존성 제거

- `@tailwindcss/line-clamp` 제거 (TailwindCSS 3.3+ 내장)
- `claude` 패키지 제거 (미사용)

### 2. ESLint max-lines 규칙 추가

```json
"max-lines": ["warn", { "max": 600, "skipBlankLines": true, "skipComments": true }]
```

### 3. 타입 파일 분리

| 파일                    | 줄 수 | 내용               |
| ----------------------- | ----- | ------------------ |
| `types/settings.ts`     | 97줄  | 사용자 설정 타입   |
| `types/notification.ts` | 122줄 | 알림 시스템 타입   |
| `types/filter.ts`       | 163줄 | 고급 필터링 타입   |
| `types/media.ts`        | 176줄 | 미디어/프로필 타입 |

### 4. LiquidMetalParticles 셰이더 분리

- `particles/shaders.ts` 생성 (355줄)
- 메인 컴포넌트: 1,394줄 → 1,207줄

---

## 🔍 추가 발견 사항 (2차 리뷰)

### 1. console.log 정리 필요

**영향 파일**: 50+ 파일  
**위치**: `src/lib/`, `src/utils/`, `src/hooks/`, `src/app/api/` 등

**권장사항**:

- 프로덕션 빌드에서 자동 제거 설정 추가
- 또는 커스텀 logger 유틸리티 사용

```javascript
// next.config.js
module.exports = {
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
}
```

### 2. TODO 주석 해결 필요

**위치**: `src/app/api/posts/[id]/route.ts:84`

```typescript
// TODO: RLS 정책 정리 후 adminClient 사용 제거 검토
```

### 3. Admin 페이지 분리 권장

| 파일                      | 현재 줄 수 | 권장                |
| ------------------------- | ---------- | ------------------- |
| `admin/members/page.tsx`  | 764줄      | 컴포넌트 분리       |
| `admin/settings/page.tsx` | 711줄      | 탭별 컴포넌트 분리  |
| `signup/page.tsx`         | 621줄      | 폼 로직 훅으로 분리 |

---

## 📊 현재 ESLint max-lines 경고 현황

| 파일                       | 줄 수   | 상태             |
| -------------------------- | ------- | ---------------- |
| `types/index.ts`           | 1,334줄 | 🔴 분리 진행 중  |
| `LiquidMetalParticles.tsx` | 1,207줄 | 🟡 셰이더 분리됨 |
| `admin/members/page.tsx`   | 764줄   | 🟠 분리 권장     |
| `admin/settings/page.tsx`  | 711줄   | 🟠 분리 권장     |
| `signup/page.tsx`          | 621줄   | 🟡 경미          |

---

## 🎯 다음 단계 권장사항

1. **console.log 자동 제거 설정** - 프로덕션 빌드 최적화
2. **TODO 주석 해결** - RLS 정책 검토
3. **Admin 컴포넌트 분리** - 재사용성 및 테스트 용이성 향상
4. **types/index.ts 추가 분리** - 게시판, 활동 추적 타입 분리
