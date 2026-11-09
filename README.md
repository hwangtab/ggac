# 경기아트콜렉티브 협동조합 웹사이트

경계 없는 상상, 함께 만드는 울림

경기아트콜렉티브 협동조합의 공식 웹사이트이자 조합원 서비스(게시판·알림·후원·타임뱅크·이사회 업무툴·관리자 메일함)입니다.

> 개발 규칙·운영 주의사항·마이그레이션 절차의 정본은 [`CLAUDE.md`](./CLAUDE.md)와 `scripts/turso/README.md`입니다. 이 문서는 개요만 다룹니다.

## 기술 스택

- **Framework**: Next.js 15 (App Router) + React 19, TypeScript
- **Styling**: Tailwind CSS
- **i18n**: next-intl — 모든 페이지는 `src/app/[locale]/` 아래에서 로케일 라우팅
- **DB**: Turso(libSQL) + Drizzle ORM (`src/db/`)
- **Auth**: Better Auth (`src/lib/auth/`), 인가는 라우트가 판정(`src/lib/server/*Auth.ts`)
- **Storage**: Vercel Blob (공개/비공개 분리)
- **Mail**: Resend (인증 메일, 메일함 수신·발신)
- **Rate limiting**: Upstash Redis (분산)
- **Testing**: node:test 단위 테스트, Playwright E2E
- **Deployment**: Vercel (`main` 푸시로 배포)

정적 콘텐츠(아티스트·프로젝트·전역 설정)는 `data/*.json`, 동적 데이터(회원·게시글·댓글·알림·이사회·활동로그)는 Turso에 있습니다.

## 프로젝트 구조

```
.
├── data/                 # 정적 JSON (artists, projects, global)
├── e2e/                  # Playwright 스펙
├── public/               # 정적 파일 (images 등)
├── scripts/              # 운영·마이그레이션·테스트 스크립트 (turso/README.md 참고)
└── src/
    ├── app/
    │   ├── [locale]/     # 페이지 (about, projects, artists, board, funding, mypage, admin, board-room ...)
    │   └── api/          # API 라우트
    ├── components/       # 공용 React 컴포넌트
    ├── db/               # Drizzle 스키마, 마이그레이션(migrations/), 쿼리 계층(queries/)
    ├── i18n/             # next-intl 설정
    ├── lib/              # 인증·인가·저장소·메일 등 서버 라이브러리
    ├── work/             # 이사회 업무툴(`@work/*`, kosmart에서 이식한 코드)
    ├── hooks/ utils/ types/ constants/ config/
    └── middleware.ts     # 인증·CSP·요청 처리
```

## 시작하기

필요: Node.js 18 이상, npm

```bash
npm install
npm run dev          # http://localhost:3000
```

환경변수는 `.env.local`에 둡니다(`vercel env pull .env.local`). 필수·선택 목록과 점검은 아래 명령이 정본입니다.

```bash
npm run env:check    # scripts/verify-env.js
```

## 자주 쓰는 명령

```bash
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm run format       # Prettier
npm run build        # 프로덕션 빌드
npm run db:push:local   # local.db에 스키마 설치 (단위 테스트 전 한 번)
npm run test:unit    # 단위 테스트
npm run test:e2e     # E2E (시스템 Chrome 사용)
```

## 운영 메모

- 분산 환경(Vercel)에서는 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`(또는 `KV_REST_API_URL`/`KV_REST_API_TOKEN`)이 필요합니다. 없거나 호출이 실패하면 프로덕션에서는 per-instance 메모리 카운터로 우회하지 않고 503으로 fail-closed 처리한다. 개발 환경에서만 인메모리 폴백을 허용한다.
- 마이그레이션은 `src/db/migrations/`가 정본이며, 코드보다 먼저 운영 DB에 적용합니다. 절차는 `scripts/turso/README.md`를 따르고 `drizzle-kit migrate`는 쓰지 않습니다.
- Supabase는 2026-08 컷오버로 은퇴했습니다. `supabase/migrations/`는 역사 기록입니다.

## 라이선스

© 2025 경기아트콜렉티브 협동조합. All rights reserved.

## 연락처

- 이메일: contact@gac.coop
