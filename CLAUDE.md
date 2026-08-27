# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Essential Development Commands

### Development Server

```bash
npm run dev          # Start local development server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint code quality check
```

### Testing & Quality Assurance

```bash
npm run build                    # Required after any code changes
npm run lint:fix                 # Auto-fix linting issues
npm run format                   # Format code with Prettier
npm run format:check             # Check code formatting
npm run type-check               # TypeScript type checking
npm run test:e2e                 # Run E2E tests
npm run test:e2e:ui              # Run E2E tests with UI
npm run audit:security           # Security audit
ANALYZE=true npm run build       # Bundle size analysis
```

### Deployment

```bash
npm run vercel:deploy           # Vercel production deployment
npm run vercel:preview          # Vercel preview deployment
npm run deploy                  # Deploy webhook trigger
npm run deploy:notify           # Deploy notification script
```

### CLI Tools Available

> **⚠ Supabase는 2026-08-26 컷오버로 은퇴했다.** 아래 Supabase CLI 명령은 **1주
> 관찰 기간 동안의 조회·최종 백업용**이며, 그 뒤 프로젝트가 삭제되면 전부
> 무의미해진다. **운영 DB 작업은 Turso로 한다** — `scripts/turso/README.md`가
> 정본이다.
>
> 이 저장소에는 아직 Supabase를 향해 쓰는 죽은 스크립트가 남아 있다. 대부분은
> 실행하면 **에러 없이 성공 메시지를 내고 아무것도 하지 않는다.** `scripts/`
> 아래 도구를 쓰기 전에 그것이 Turso를 보는지 확인해라.

Both **Vercel CLI** and **Supabase CLI** are installed globally and can be
invoked directly (no need to wrap through npm scripts).

```bash
# Vercel CLI (installed via fnm global)
vercel --version                # Check version
vercel whoami                   # Current account
vercel env pull .env.local      # Pull env vars to local
vercel env ls                   # List environment variables
vercel deploy                   # Preview deployment
vercel deploy --prod            # Production deployment
vercel logs <deployment-url>    # View runtime logs
vercel inspect <deployment-url> # Inspect a deployment

# Supabase CLI (installed via Homebrew)
supabase --version              # Check version
supabase status                 # Local dev stack status
supabase db push                # Apply migrations to linked project
supabase db pull                # Pull remote schema to local
supabase migration new <name>   # Create a new migration
supabase migration list         # List migrations (local vs remote)
supabase gen types typescript   # Generate TS types from DB schema
supabase link --project-ref <ref>  # Link local repo to remote project
```

Use these CLIs directly for env sync, migration work, and deployment inspection
rather than spinning up one-off scripts. For destructive operations (e.g.,
`db push` to production, `env rm`), confirm with the user first.

### Browser Tooling: Aside vs Chrome DevTools MCP

브라우저 작업은 두 MCP의 역할을 나눠 쓴다. 경쟁 관계가 아니라 **인터랙션은
Aside, 계측은 Chrome DevTools** 담당이다.

- **Aside** (`mcp__aside__repl`): 다단계 인터랙션·폼 시나리오·스크래핑·관리자
  화면 등 로그인 필요한 페이지 검증, Playwright E2E 셀렉터 프로토타이핑.
  사용자의 실제 브라우저 세션(운영 사이트 로그인 상태 포함)에 붙고, Playwright
  호환 API를 영속 JS 스코프에서 실행하므로 한 호출에 여러 단계를 묶는다. 단,
  `page.route`가 없어 네트워크 계측은 불가.
- **Chrome DevTools** (`mcp__chrome-devtools__*`): 네트워크 요청 목록·상세 분석,
  콘솔 메시지 수집(CSP 위반 확인), 성능 트레이스(LCP/CLS), lighthouse 감사, 힙
  스냅샷, 기기/네트워크 에뮬레이션. 성능 측정 전 CSS 200 가드 같은 네트워크
  검증도 이쪽.

참고: 설치된 aside는 Aside Browser 제품(`~/.local/bin/aside`)이며,
github.com/egozverev/aside(ICLR 논문)와는 무관하다.

### Post-Task Checklist

After completing any development task:

1. Run `npm run lint:fix` - auto-fix linting issues
2. Run `npm run format` - format code consistently
3. Run `npm run type-check` - verify TypeScript types
4. Run `npm run build` - ensure build succeeds
5. Test locally at http://localhost:3000
6. Run `npm run test:e2e` if UI changes were made
7. Only commit if all checks pass

## Architecture Overview

This is a **Next.js 15 App Router** project for 경기아트콜렉티브 협동조합
(Gyeonggi Art Collective Cooperative).

### Key Technologies

- **Framework**: Next.js 15.4.4 (App Router) + React 19
- **Language**: TypeScript (strict: false for gradual migration)
- **Styling**: Tailwind CSS + custom particle systems (WebGL/Canvas)
- **Backend**: Next.js API routes + Turso(libSQL)
- **Database**: Turso + Drizzle ORM. 쿼리 계층은 `src/db/queries/`에 있고
  **권한을 모른다**(`NextResponse`·`next/headers`·인가 임포트 금지) — 인가는
  전부 라우트가 판정한다
- **Auth**: Better Auth (`src/lib/auth/`)
- **Storage**: Vercel Blob — 공개(첨부·아티스트 사진)와 비공개(이사회 서류·백업)
  분리
- **Rich Text**: React Quill editor + react-markdown with DOMPurify sanitization
- **Image Processing**: Sharp for optimization, WebP-first delivery
- **Rate Limiting**: Upstash Redis (distributed) with memory fallback
- **Testing**: Playwright E2E testing with UI mode
- **Code Quality**: ESLint, Prettier, TypeScript, Husky hooks
- **Deployment**: Vercel with automatic deployments

### Data Management Strategy

- **Static Content**: JSON files in `/data/` directory (artists.json,
  projects.json, global.json)
- **Dynamic Content**: Turso 데이터베이스
  (회원·게시글·댓글·알림·이사회·활동로그)
- **Images**: Static files in `/public/images/` with WebP optimization

### Critical Components

- `OptimizedImage.tsx` - Advanced image loading with WebP → JPEG → JPG → PNG
  fallback chain
- `middleware.ts` - Authentication and request handling
- API routes use standardized `ApiSuccess`/`ApiError` response format
- Error tracking system monitors ResourceLoadErrors and other issues

## Code Conventions

### File Structure

```
src/
├── app/                 # Next.js App Router pages & API routes
├── components/          # Reusable React components
├── utils/              # Utility functions (apiResponse.ts, etc.)
├── hooks/              # Custom React hooks
├── lib/                # External library configurations
├── types/              # TypeScript type definitions
└── constants/          # Application constants
```

### Naming Conventions

- Components: `PascalCase.tsx` (e.g., `OptimizedImage.tsx`)
- Hooks: `use*.ts` prefix (e.g., `useAuth.ts`)
- Utilities: `camelCase.ts` (e.g., `apiResponse.ts`)
- API routes: `route.ts`

### TypeScript Configuration

- Uses `strict: false` for gradual migration
- Path alias: `@/*` maps to `src/*`
- Prefer type definitions over interfaces

### Styling Guidelines

- **Primary**: Tailwind CSS utility classes
- **Custom CSS**: Add to `globals.css` only when necessary
- **Responsive**: Always implement mobile-first design
- **Interactive Effects**: Custom particle systems using WebGL/Canvas

## Security & Performance

### Image Optimization

- All images processed through `OptimizedImage` component
- Comprehensive fallback: WebP → JPEG → JPG → PNG
- Mac environment compatibility (prioritizes .jpeg extensions)

### Security Headers

- Comprehensive CSP policy in `next.config.js`
- MIME type validation for all static assets
- XSS and CSRF protection

### Performance Monitoring

- Bundle analysis available via `ANALYZE=true npm run build`
- Lazy loading for heavy components
- WebP-first image delivery

## Database & API

### API Response Format

**표준(정본)**: 신규·전환 API 라우트는 `@/utils/apiWrapper`의 클래스형
`ApiSuccess` / `ApiError`를 사용한다. 함수형 헬퍼(`@/utils/apiResponse`의
`createSuccessResponse` / `createErrorResponse`)는 `apiWrapper` 내부 구현과
레거시 하위호환용이며, 신규 코드에서 직접 호출하지 않는다.

성공 응답 본문은 `{ success: true, data, message?, meta }` 형태로 표준화된다
(클래스형은 항상 `data` 키 아래에 페이로드를 감싼다). 라우트를 전환할 때는 소비
클라이언트가 기대하는 응답 스키마(예: `res.data.xxx`)를 반드시 보존한다.

```typescript
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

// Success responses
return ApiSuccess.ok(data, 'Optional success message').toNextResponse()
return ApiSuccess.created(data, 'Resource created').toNextResponse()
return ApiSuccess.noContent('Operation completed').toNextResponse()

// Error responses (withApiWrapper 안에서는 throw, 그 밖에서는 return .toNextResponse())
throw ApiError.badRequest('Invalid input')
throw ApiError.unauthorized('Login required')
throw ApiError.forbidden('Access denied')
throw ApiError.notFound('Resource not found')
throw ApiError.tooManyRequests('Rate limit exceeded')
throw ApiError.internalServerError('Server error')
```

### Authentication & Middleware

- **Authentication**: Better Auth (세션 쿠키 캐시 5분, 세션 7일)
- **Authorization**: Role-based access control (admin/user)
- **Middleware**: Handles auth, CSP headers, and request processing
- **Rate Limiting**: Distributed rate limiting via
  `@/utils/distributedRateLimiter` (Upstash Redis REST). 인스턴스별 메모리
  폴백은 단일 노드 환경에서만 의미가 있으며, Vercel 등 분산 환경에서는
  `UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN`을 반드시 설정해야 한다.
  운영 환경에서 폴백이 사용되면 부팅 시점에 보안 로그
  (`RATE_LIMIT_MEMORY_FALLBACK`)가 high 심각도로 기록된다. 레거시 인메모리 모듈
  `@/utils/rateLimiter`는 신규 코드에서 사용 금지.
- **Error Handling**: Centralized error handling with `ApiErrorHandler`

### Key Middleware Features

- CSP policy enforcement (strict for general pages, relaxed for editor)
- Authentication state management
- Rate limiting for media upload and link preview endpoints
- Request/response logging and monitoring

## Common Issues & Solutions

### Image Loading Errors

- Check file extensions (Mac uses .jpeg, Windows .jpg)
- Verify files exist in `/public/images/` directory
- Use `OptimizedImage` component for automatic fallback

### Build Failures

- Run `npm run lint` first to catch syntax errors
- Check TypeScript type errors
- Verify import paths use `@/*` alias

### CSP Violations

- Development allows 'unsafe-eval' for React hot reload
- Production has stricter CSP policy
- YouTube embeds require frame-src allowlist

### Environment Variables Issues

**필수** (없으면 앱이 뜨지 않는다):

- `TURSO_DATABASE_URL` — 원격(`libsql://`)이면 `TURSO_AUTH_TOKEN`도 **필수**.
  `file:`·루프백은 토큰 없이 동작한다(`assertProductionCredentials`)
- `TURSO_AUTH_TOKEN`
- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL` — **비면 모든 Blob 사진이 기본 로고로
  바뀐다** (`isBlobPublicUrl`이 항상 false가 된다). 에러는 안 난다
- `PUBLIC_BLOB_READ_WRITE_TOKEN` / `PRIVATE_BLOB_READ_WRITE_TOKEN`
- `NEXT_PUBLIC_SUPABASE_URL` — **DB 연결용이 아니다.** DB에 남은 레거시 Storage
  절대 URL을 "우리 것"으로 인정하는 판정 4곳이 읽는다

**선택**: `UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN`(분산 레이트리밋 —
없으면 인스턴스별 메모리 폴백이라 Vercel에서 사실상 무효), `RESEND_API_KEY`(인증
메일. **없으면 가입·재설정이 200을 반환하고 메일만 안 간다**),
`NEXT_STRICT_CSP=true`.

정본은 `npm run env:check`(`scripts/verify-env.js`)다.

### Database Migration Issues

- 마이그레이션 정본은 **`src/db/migrations/`**(Drizzle)다.
  `supabase/migrations/`는 **역사 기록**이며 더 이상 적용하지 않는다
- **`drizzle-kit migrate`를 쓰지 마라.** `0002`~`0004`는 파일 안에
  `BEGIN`/`COMMIT`과 자체 단언이 있어 마이그레이터가 감싸면 실패한다. 적용
  절차는 `scripts/turso/README.md`에 있다
- **RLS는 더 이상 존재하지 않는다.** Postgres가 행 단위로 막아주던 것을 이제
  **앱 코드가 전부 판정한다**. "RLS 정책을 고친다"는 접근은 아무것도 바꾸지
  않으면서 경계가 지켜진다고 믿게 만든다.
- **권한의 안전망은 E2E다. 정적 가드가 아니다.** 인가를 바꿨으면
  `npm run test:e2e:authz`(기준선 **50 passed**, 실행법은
  `scripts/turso/README.md`)를 돌려라.
  `scripts/testing/assert-runtime-risks.mjs`의 계약은 **보조**다 — 적대
  감사(2026-08-27)가 15가지 우회를 시도해 **11가지가 초록불**이었다. 예:
  `src/lib/server/authz.ts`의 `isApprovedActive` 맨 앞에
  `if (profile) return true` 한 줄을 넣으면 관리자 API 26개가 열리는데 가드도
  `tsc`도 통과한다. 가드는 **"이 문자열이 이 파일에 있는가"**를 볼 뿐 도달
  가능성·실행 순서·데이터 흐름을 보지 않는다. 같은 감사에서 **E2E는 관리자
  게이트 무력화를 실제로 잡았다.** 인가 코드는
  `src/lib/server/*Auth.ts`·`src/lib/server/authz.ts`에 있다
- 스키마 변경 후 `npm run db:parity`로 확인한다. **인자로 URL을 주지 않으면
  `file:local.db`를 본다** — 운영을 보려면 URL을 명시해야 한다

This codebase emphasizes user experience through advanced image optimization,
comprehensive error handling, performance-focused architecture, and robust
security practices with distributed rate limiting and caching systems.
