# 코드베이스 아키텍처

## 디렉토리 구조

```
src/
├── app/                    # Next.js 15 App Router
│   ├── api/               # API 라우트
│   ├── admin/             # 관리자 페이지
│   ├── artists/           # 아티스트 페이지
│   ├── archive/           # 활동 기록
│   ├── about/             # 조합 소개
│   ├── connect/           # 연락 및 참여
│   ├── mypage/            # 마이페이지
│   └── auth/              # 인증 관련
├── components/            # React 컴포넌트
├── utils/                 # 유틸리티 함수
├── hooks/                 # 커스텀 훅
├── lib/                   # 외부 라이브러리 설정
├── types/                 # TypeScript 타입 정의
└── constants/            # 상수 정의
```

## 주요 아키텍처 패턴

### 1. 데이터 관리

- **정적 데이터**: `data/*.json` 파일 (프로젝트, 아티스트 정보)
- **동적 데이터**: Supabase (사용자, 게시물, 댓글)
- **이미지**: `public/images/` 폴더에 정적 저장

### 2. 인증 시스템

- Supabase Auth 기반
- 미들웨어에서 인증 상태 관리
- 역할 기반 접근 제어 (관리자/일반 사용자)

### 3. API 구조

- RESTful API 설계
- 표준화된 응답 포맷 (ApiSuccess/ApiError)
- 에러 트래킹 시스템

### 4. 이미지 최적화

- Next.js Image 컴포넌트 사용
- WebP 우선 제공, 다중 포맷 폴백
- CDN 캐싱 최적화

### 5. 보안

- CSP 헤더 설정
- MIME 타입 검증
- XSS 방지
- CSRF 보호
