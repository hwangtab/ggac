# 코딩 컨벤션 및 스타일 가이드

## TypeScript 설정
- `strict: false` 설정으로 점진적 마이그레이션 지원
- `@/*` 경로 별칭 사용
- 인터페이스보다 타입 우선 사용

## React 컴포넌트 패턴
- 함수형 컴포넌트 사용
- 커스텀 훅으로 로직 분리
- Props 인터페이스 명시적 정의

## 파일 명명 규칙
- 컴포넌트: PascalCase (예: `OptimizedImage.tsx`)
- 훅: `use` 접두사 (예: `useAuth.ts`)
- 유틸리티: camelCase (예: `apiResponse.ts`)
- API 라우트: `route.ts`

## CSS/Styling
- Tailwind CSS 유틸리티 클래스 우선
- 커스텀 CSS는 `globals.css`에 정의
- 반응형 디자인 필수 (`sm:`, `md:`, `lg:` 사용)

## ESLint 규칙
- `react/no-unescaped-entities`: off
- `@next/next/no-img-element`: warn
- `react-hooks/exhaustive-deps`: warn

## 에러 처리
- API 응답: `ApiSuccess`/`ApiError` 유틸리티 사용
- 프론트엔드: ErrorBoundary 컴포넌트 사용
- 로깅: console.error 대신 에러 트래킹 시스템 사용

## 성능 최적화
- 지연 로딩: `LazyComponents.tsx` 사용
- 이미지 최적화: `OptimizedImage` 컴포넌트
- 번들 분할: Next.js 자동 코드 스플리팅 활용