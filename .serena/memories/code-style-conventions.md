# 코드 스타일 및 컨벤션

## TypeScript 설정
- **strict mode** 활성화 - 엄격한 타입 체크
- **Path alias**: `@/*`는 `src/*`로 매핑
- **ES5 타겟**, **ESNext 모듈** 사용

## ESLint 규칙
- Next.js core-web-vitals 확장
- `react/no-unescaped-entities`: off
- `@next/next/no-img-element`: off (표준 img 태그 허용)
- `react-hooks/exhaustive-deps`: warn

## Tailwind CSS 컨벤션
- **컬러 시스템**: primary (파란색), accent (오렌지색) 팔레트
- **폰트**: Pretendard (sans), Noto Serif KR (serif)
- **유틸리티 클래스**:
  - `.card-base`, `.card-hover`, `.card-interactive` - 카드 스타일
  - `.btn-primary`, `.btn-secondary`, `.btn-accent` - 버튼 스타일
  - `.badge-primary`, `.badge-secondary`, `.badge-accent` - 배지 스타일
  - `.form-input`, `.form-textarea`, `.form-select` - 폼 스타일
  - `.grid-cards`, `.grid-artists` - 그리드 패턴

## 파일 구조 컨벤션
- **App Router** 사용 (`src/app/` 디렉토리)
- **컴포넌트**: `src/components/` (기능별 분류)
- **유틸리티**: `src/utils/`, `src/hooks/`, `src/lib/`
- **타입**: `src/types/index.ts` (중앙집중식 타입 관리)
- **데이터**: `/data/` 디렉토리의 JSON 파일

## 코딩 패턴
- **데이터 로딩**: React `cache()` 함수 사용한 캐시된 함수
- **성능 최적화**: 단계적 fallback (WebGL → CSS → Static)
- **이미지**: OptimizedImage 컴포넌트 + WebP 우선
- **인증**: 미들웨어 패턴으로 라우트 보호