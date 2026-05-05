# 경기아트콜렉티브 협동조합 웹사이트

경계 없는 상상, 함께 만드는 울림

## 프로젝트 개요

이 웹사이트는 경기아트콜렉티브 협동조합의 공식 웹사이트입니다. 예술가들의 창의적 활동과 협동조합의 철학을 디지털 공간에서 표현하고, 방문자들이 몰입감 있는 예술적 경험을 할 수 있도록 설계되었습니다.

## 기술 스택

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Animation**: Framer Motion
- **State Management**: Zustand
- **Markdown**: react-markdown
- **Deployment**: Vercel (정적 사이트 생성)

## 프로젝트 구조

```
.
├── data/                    # JSON 데이터 파일
│   ├── artists.json        # 아티스트 정보
│   ├── projects.json       # 프로젝트 정보
│   └── global.json         # 전역 설정
├── public/                  # 정적 파일
│   └── images/             # 이미지 파일
│       ├── artists/        # 아티스트 프로필 이미지
│       └── projects/       # 프로젝트 이미지
├── src/
│   ├── app/                # Next.js App Router 페이지
│   │   ├── about/          # 우리의 이야기 페이지
│   │   ├── archive/        # 활동의 기록 페이지
│   │   ├── artists/        # 함께하는 사람들 페이지
│   │   ├── connect/        # 소통과 참여 페이지
│   │   └── layout.tsx      # 전역 레이아웃
│   └── components/         # React 컴포넌트
└── README.md
```

## 시작하기

### 필수 요구사항

- Node.js 18.0.0 이상
- npm 또는 yarn

### 설치 및 실행

1. 저장소 클론
```bash
git clone [repository-url]
cd GAC
```

2. 의존성 설치
```bash
npm install
```

3. 개발 서버 실행
```bash
npm run dev
```

4. 브라우저에서 확인
```
http://localhost:3000
```

### 빌드 및 배포

```bash
# 정적 사이트 빌드
npm run build

# 로컬 서버에서 빌드 결과 확인
npm run start
```

## 환경 변수 설정

아래 값을 로컬(`.env.local`)과 Vercel(Development/Preview/Production)에 설정하세요.

- 필수(클라이언트/서버 공용)
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- 필수(서버 전용)
  - `SUPABASE_SERVICE_ROLE_KEY` (서비스 롤 키 — 서버에서만 사용)
- 권장
  - `NEXT_PUBLIC_SITE_URL` (예: Production: https://ggac.kr, Preview: Vercel Preview URL)
  - `NEXT_PUBLIC_DOMAIN`
  - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (있으면 분산 레이트리밋 활성)

### 링크 프리뷰 캐시
- 인메모리(1시간) + Supabase 영속 캐시(기본 6시간)를 사용합니다.
- 영속 캐시 활성 조건: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- 테이블/마이그레이션: `supabase/migrations/20250904_add_link_previews_cache.sql`

### 보안/운영
- 일반 페이지는 강화된 CSP 적용(미들웨어에서 inline script 최소화), 에디터 페이지는 호환을 위해 완화.
- `/api/link-preview`, `/api/media/upload`에 분산 레이트리밋 적용(Upstash 없으면 메모리 폴백).
- ⚠️ **프로덕션(Vercel 등 분산/서버리스 환경)에서는 반드시 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 을 설정해야 함.** 메모리 폴백은 인스턴스마다 카운터가 분리돼 사실상 rate limit이 무력화된다(서버 시작 시 ERROR 로그로 경고).

## 페이지 구성

### 1. HOME (/)
- **목적**: 첫 인상과 브랜드 정체성 전달
- **특징**: 인터랙티브 파티클 효과, 최신 프로젝트/아티스트 미리보기

### 2. ABOUT (/about)
- **목적**: 조합의 설립 목적과 철학 소개
- **구성**: 설립 목적, 이사장 메시지, 연혁 타임라인

### 3. ARCHIVE (/archive)
- **목적**: 조합의 활동 결과물 전시
- **특징**: 카테고리별 필터링, 프로젝트 상세 페이지 연결

### 4. ARTISTS (/artists)
- **목적**: 조합원 소개 및 개별 프로필 제공
- **특징**: 창작자/기획자 필터링, 개인별 템플릿 지원

### 5. CONNECT (/connect)
- **목적**: 가입 안내 및 후원 문의 연결
- **특징**: 외부 폼 연동, 연락처 정보 제공

## 데이터 관리

모든 콘텐츠는 `/data` 폴더의 JSON 파일로 관리됩니다:

- `artists.json`: 아티스트 프로필 정보
- `projects.json`: 프로젝트 및 작품 정보
- `global.json`: 사이트 전역 설정 및 연락처

### 콘텐츠 업데이트 방법

1. 해당 JSON 파일 수정
2. Git commit 및 push
3. 자동 배포 (Vercel)

## 개발 가이드

### 컴포넌트 추가
새로운 컴포넌트는 `/src/components/` 폴더에 추가합니다.

### 페이지 추가
새로운 페이지는 `/src/app/` 폴더에 추가합니다. (App Router 규칙 따름)

### 스타일링
- Tailwind CSS 유틸리티 클래스 사용
- 커스텀 클래스는 `globals.css`에 정의
- 반응형 디자인 고려

### 애니메이션
Framer Motion을 사용하여 부드러운 인터랙션 구현

## 배포

이 프로젝트는 Vercel을 통해 자동 배포됩니다:

1. `main` 브랜치에 Push
2. Vercel이 자동으로 빌드 및 배포
3. 프리뷰 URL 생성 (PR 시)

## 빠른 배포/검증 체크리스트

- 환경변수 확인(Vercel)
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`(Preview/Prod)
  - `SUPABASE_SERVICE_ROLE_KEY`(모든 환경, 서버 전용)
  - 선택: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DOMAIN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- 마이그레이션 적용 여부
  - Supabase 콘솔에서 `supabase/migrations/20250904_add_link_previews_cache.sql` 실행 완료 확인
  - 테이블 `public.link_previews` 존재 및 RLS 활성 확인
- 프리뷰 재배포
  - PR 생성 또는 `git commit --allow-empty -m "chore: redeploy" && git push`
  - 혹은 `vercel deploy` (옵션)
- 기능 검증(Preview URL 기준)
  - 링크 프리뷰 API: `GET /api/link-preview?url=<뉴스기사URL>` → 200/JSON, 재호출 시 캐시 적중(응답 지연 감소)
  - 영속 캐시: Supabase `link_previews`에 row 생성 확인
  - 레이트리밋: `/api/link-preview` 여러 번 호출 시 `X-RateLimit-*` 헤더 표기, 과다 호출 시 429
  - 미디어 업로드: `/api/media/upload` POST로 작은 이미지 업로드 → 200, 공개 URL 생성, 과다 업로드 시 429
  - CSP: 홈/아티스트 등 일반 페이지 콘솔 경고 없음, 에디터 페이지는 정상 동작(툴바/입력 가능)
  - 홈 헤더: 최상단에서 투명, 스크롤 시 불투명 전환
- SEO 파일
  - `/robots.txt`(API로 제공), `/sitemap.xml` 경로 접근 시 200
- 이미지 정책
  - 외부 미리보기 이미지/파비콘은 프록시 경유로 정상 표시, 콘솔 오류 없음

## 라이선스

© 2025 경기아트콜렉티브 협동조합. All rights reserved.

## 연락처

- 이메일: contact@gac.coop
- 전화: 031-000-0000
