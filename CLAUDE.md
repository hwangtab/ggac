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
- **Backend**: Next.js API routes + Supabase
- **Database**: Supabase PostgreSQL with link preview caching
- **Auth**: Supabase Auth with role-based access control
- **Rich Text**: React Quill editor + react-markdown with DOMPurify sanitization
- **Image Processing**: Sharp for optimization, WebP-first delivery
- **Rate Limiting**: Upstash Redis (distributed) with memory fallback
- **Testing**: Playwright E2E testing with UI mode
- **Code Quality**: ESLint, Prettier, TypeScript, Husky hooks
- **Deployment**: Vercel with automatic deployments

### Data Management Strategy

- **Static Content**: JSON files in `/data/` directory (artists.json,
  projects.json, global.json)
- **Dynamic Content**: Supabase database (users, posts, comments, notifications)
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

- **Authentication**: Supabase Auth with JWT tokens
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

- Always set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Set `SUPABASE_SERVICE_ROLE_KEY` for server-side operations
- Optional: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for
  distributed rate limiting
- Use `NEXT_STRICT_CSP=true` to enable strict CSP in development

### Database Migration Issues

- Run migrations from `supabase/migrations/` directory
- Ensure `link_previews` table exists for caching functionality
- Check RLS policies are properly configured

This codebase emphasizes user experience through advanced image optimization,
comprehensive error handling, performance-focused architecture, and robust
security practices with distributed rate limiting and caching systems.
