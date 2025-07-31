# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm run dev` - Start development server on localhost:3000
- `npm run build` - Build production version
- `npm run start` - Start production server
- `npm run lint` - Run ESLint for code quality checks

### Testing Commands
- No formal test framework is set up, but manual testing scripts exist:
  - `node test-website.js` - Test local development server endpoints
  - `node test-board.js` - Test board functionality with Playwright (requires browser)
  - `node test-signup-flow.js` - Test member registration and authentication flow
  - `node test-image-loading.js` - Test image optimization and loading
  - `node test-security-fixes.js` - Test security vulnerability fixes
  - `node test-mobile-login.js` - Test mobile login flows across different devices with Playwright
  - `node test-design-pages.js` - Test design and layout components
  - `node check-supabase-status.js` - Verify Supabase connection and database status

### Vercel Commands
- `npm run vercel:build` - Build for Vercel deployment
- `npm run vercel:dev` - Start Vercel development server
- `npm run vercel:deploy` - Deploy to production
- `npm run vercel:preview` - Deploy preview version

### Additional Commands
- `npm run deploy` - Trigger manual deployment via webhook  
- `npm run deploy:notify` - Send deployment notification to Slack

### Rate Limiting System
The codebase includes a comprehensive rate limiting system in `src/utils/rateLimiter.ts`:
- `GENERAL_API`: 60 requests per minute for standard API calls
- `AUTH_API`: 10 requests per minute for authentication endpoints
- `ADMIN_API`: 100 requests per minute for admin operations
- `POST_CREATION`: 5 requests per minute for content creation
- `SEARCH_API`: 30 requests per minute for search operations
- `FILE_UPLOAD`: 10 requests per hour for file uploads
- `BULK_OPERATIONS`: 5 requests per hour for bulk operations

### Bundle Analysis
- `ANALYZE=true npm run build` - Generate bundle analysis report using @next/bundle-analyzer
- View results at http://localhost:8888 after build completion

## Architecture Overview

This is a **Next.js 14 App Router** application for 경기아트콜렉티브 협동조합 (Gyeonggi Art Collective Cooperative). The site combines a public showcase for artists and projects with a private member board system.

### Key Technologies
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript with strict mode
- **Styling**: Tailwind CSS with custom design system
- **Animation**: Framer Motion for smooth interactions
- **State Management**: Zustand for global state
- **Authentication**: Supabase Auth with RLS (Row Level Security)
- **Database**: Supabase PostgreSQL
- **Content**: Markdown support via react-markdown
- **Deployment**: Vercel with static site generation
- **Performance**: WebGL particles, device-adaptive components, real-time monitoring
- **Testing**: Playwright for board functionality, custom test scripts

### Data Architecture

#### Public Content
Content is managed through JSON files in the `/data` directory:
- `artists.json` - Artist profiles and information
- `projects.json` - Project details and media
- `global.json` - Site-wide configuration and contact info

Data is accessed through cached functions in `src/lib/data.ts` which provide both async and sync versions for different use cases.

### Data Loading Architecture
- React `cache()` function used for efficient data fetching
- Async functions (preferred): `getArtists()`, `getProjects()`, `getGlobalData()`
- Sync functions (legacy compatibility): `getArtistsSync()`, `getProjectsSync()`, `getGlobalDataSync()`
- Specialized functions: `getArtistBySlug()`, `getProjectBySlug()`, `getFeaturedProjects()`
- Type-safe interfaces defined in `src/types/index.ts`: `Artist`, `Project`, `GlobalData`
- Centralized type system with comprehensive interfaces for all data structures

#### Member Board System
Database-driven content using Supabase:
- `member_profiles` - User registration and approval status, extended with artist fields
- `posts` - Member board posts with categories (공지, 잡담, 홍보, 건의)
- `comments` - Nested comments on posts
- `artists` - Artist profile data migrated from JSON to database (supports mypage system)

### Route Structure

#### Public Routes
- `/` - Home page with featured content
- `/about` - Cooperative story and philosophy
- `/archive` - Project gallery with filtering
- `/artists` - Artist directory with individual profiles
- `/connect` - Contact and membership information

#### Authentication Routes
- `/login` - Member login
- `/signup` - Initial user registration  
- `/register/pending` - Approval waiting page
- `/register/rejected` - Rejection notification page
- `/auth/callback` - Supabase auth callback handler

#### Protected Routes
- `/board` - Member-only board (requires approval)
- `/admin` - Admin panel (requires admin privileges)
  - `/admin/members` - Member management and approval system
  - `/admin/artists` - Artist profile management
  - `/admin/posts` - Board post moderation
  - `/admin/notifications` - System notification management
  - `/admin/reports` - Analytics and reporting
  - `/admin/settings` - System configuration
- `/mypage` - Member dashboard and profile management (requires approval)

#### Mypage System Routes
- `/mypage` - Main dashboard with overview and navigation cards
- `/mypage/profile` - Personal profile editing (member info, contact, cooperative details)
- `/mypage/artist` - Artist profile management (requires artist permissions)
- `/mypage/settings` - User preferences and settings (planned)
- `/mypage/activity` - Activity log and history (planned)

### Component Architecture
Components are organized by purpose:
- **Layout**: Navigation, Footer, Hero sections
- **Content**: ArticleCard, FeaturedProjects, FeaturedArtists
- **Media**: OptimizedImage, YouTubeEmbed, Lightbox
- **Interactive**: TicketingCard with external links
- **Board System**: PostList, CreatePostForm, CommentSection
- **Mypage System**: MypageLayout, MypageNavigation, PermissionCheck, DashboardCard
- **Performance**: AdaptiveParticles, PerformanceMonitor, device detection hooks
- **Particles**: WebGL, CSS, Network, LiquidMetal variants with fallback system

### Image Optimization
- All images stored in `/public/images/` with organized subdirectories
- Both original and WebP formats maintained
- Next.js Image component used with aggressive optimization settings
- Custom OptimizedImage component handles fallbacks

### Styling System
- Custom Tailwind theme with primary/accent color palettes (blue and orange schemes)
- Korean typography support with Pretendard and Noto Serif KR fonts
- Responsive design with mobile-first approach
- Custom animations for floating elements and smooth transitions
- Utility-first CSS approach with custom component classes (`.card-base`, `.btn-primary`, `.badge-*`)
- Comprehensive form styling utilities (`.form-input`, `.form-textarea`, `.form-select`)
- Pre-built grid patterns (`.grid-cards`, `.grid-artists`) for consistent layouts

### Performance Optimization System

#### Particle System Architecture
- **AdaptiveParticles**: Main component that selects optimal particle type based on device capabilities
- **Device Detection**: Automatic fallback from WebGL → CSS → Static based on performance
- **Performance Monitoring**: Real-time FPS tracking with automatic degradation
- **Reduced Motion**: Respects `prefers-reduced-motion` accessibility setting
- **Memory Management**: Proper cleanup on component unmount

#### Component Variants by Performance Level
1. **High Performance**: WebGLParticles, LiquidMetalParticles with full effects
2. **Medium Performance**: CSSParticles with transform animations
3. **Low Performance**: Static background or minimal effects
4. **Accessibility**: Respects reduced motion preferences

#### Performance Hooks
- `useDevicePerformance()`: Detects device capabilities (GPU, RAM, CPU)
- `usePerformanceMonitor()`: Real-time FPS and resource monitoring
- `usePrefersReducedMotion()`: Accessibility compliance
- `useIntersectionObserver()`: Lazy loading and viewport optimization

#### Browser Optimization
- Bundle analysis via `ANALYZE=true npm run build`
- Aggressive image optimization (WebP, AVIF)
- Code splitting and dynamic imports
- Service worker for caching (if implemented)

### Content Management

#### Public Content
- JSON-based content system for easy updates
- Structured data types with TypeScript interfaces
- Cached data loading for performance
- Static generation for all pages

#### Member Board Content
- Database-driven with real-time updates
- Manual member approval workflow via Supabase dashboard
- Row Level Security policies enforce access control
- Category system for organizing posts (공지, 잡담, 홍보, 건의)

## Authentication & Authorization

### Supabase Configuration
- Authentication handled via `@supabase/auth-helpers-nextjs`
- Client instance created in `src/lib/supabase/client.ts`
- Middleware in `src/middleware.ts` protects routes based on authentication status and member approval
- Middleware configuration includes specific path matchers for `/login`, `/signup`, `/board/*`, `/admin/*`, and registration pages

### Member Registration Flow
1. User signs up via `/signup` - creates basic auth user
2. Profile automatically created via trigger with `registration_status: 'pending'`
3. User redirected to `/register/pending` to wait for approval
4. Admin approves via Supabase dashboard by updating `registration_status` to 'approved'
5. Approved members can access `/board`

### Member Status Management
- `registration_status` values: 'pending', 'approved', 'rejected'
- `is_active` flag controls member access even after approval
- `is_admin` flag grants admin privileges for `/admin` routes
- `is_artist` flag enables artist profile management in mypage system
- `artist_id` links member to specific artist profile (assigned manually by admin)
- `artist_role` defines permissions: 'owner', 'manager', 'collaborator'
- Middleware automatically redirects users to appropriate pages based on their status

### Database Schema
Key tables managed in `supabase/migrations/`:
- `member_profiles` - Extended user profiles with approval workflow
- `posts` - Board posts with categories and soft delete
- `comments` - Threaded comments on posts

### Row Level Security (RLS)
- Members can only view posts after approval
- Users can only edit their own content
- Admins have elevated privileges for management

## Development Notes

### Path Aliases
- `@/*` maps to `src/*` for cleaner imports

### Key File Locations
- **Core Data Loading**: `src/lib/data.ts` - cached data functions
- **Type Definitions**: `src/types/index.ts` - centralized type system
- **Authentication Middleware**: `src/middleware.ts` - route protection and user state management
- **Security Utils**: `src/utils/security.ts` - XSS prevention and sanitization
- **Performance Hooks**: `src/hooks/useDevicePerformance.ts`, `src/hooks/usePerformanceMonitor.ts`
- **Database Migrations**: `supabase/migrations/` - versioned schema changes
- **Test Scripts**: Root directory - `test-*.js` files for manual testing

### TypeScript Configuration
- Strict mode enabled with comprehensive type checking
- Path mapping configured for clean imports
- Next.js plugin integrated for optimal builds

### Environment Variables Required
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase public API key
- `SUPABASE_SERVICE_ROLE_KEY` - For admin operations and RLS policy bypass (critical for member management)

### ESLint Configuration
Custom rules configured in `.eslintrc.json`:
- Disables React unescaped entities warning
- Allows standard img elements alongside Next.js Image
- Warns on missing dependencies in React hooks

### Build Requirements
- Node.js 18+ required
- All builds must pass TypeScript compilation
- ESLint must pass without errors before deployment
- Database migrations must be applied to Supabase

### Database Migrations
Apply migrations to Supabase:
```bash
# Through Supabase Dashboard SQL Editor
# Copy and run contents of supabase/migrations/*.sql files
```

### Deployment
- Automatic deployment via Vercel on push to main branch
- Environment variables configured in Vercel dashboard
- Custom domain: https://ggac.kr
- Database hosted on Supabase with automatic backups

### Manual Deployment & Monitoring
- `npm run deploy` - Triggers webhook-based deployment
- `npm run deploy:notify` - Sends deployment notifications to Slack
- Manual testing scripts available for endpoint verification
- Slack notifications configured for deployment updates (channel: #웹사이트)

### CI/CD Pipeline
- **GitHub Actions**: Automated build and lint testing on every push to main
- **Build Verification**: Ensures TypeScript compilation and ESLint compliance
- **Deployment**: Automatic via Vercel Git integration (separate from build testing)
- **Notifications**: Slack integration for deployment status updates

## Security Configuration

### Content Security Policy
- Comprehensive CSP headers configured in `next.config.js`
- Allows YouTube embeds and Supabase connections
- Prevents XSS and other security vulnerabilities
- Enhanced security headers including X-Frame-Options, X-Content-Type-Options

### Input Sanitization
- Security utilities in `src/utils/security.ts`
- XSS prevention for user-generated content
- Safe HTML rendering for board posts and comments

## Important Development Notes

### Code Quality Requirements
- **ALWAYS** run `npm run lint` before committing changes
- TypeScript strict mode must pass without errors
- Use the centralized type system in `src/types/index.ts`
- Follow existing patterns for data loading (prefer async functions with React cache)

### Authentication Flow Testing
- Use `node test-signup-flow.js` to verify registration works end-to-end
- Test different user states: pending, approved, rejected
- Verify middleware redirects work correctly for all route combinations

### Database Operations
- All database schema changes must be versioned in `supabase/migrations/`
- Test RLS policies thoroughly before deployment
- Use the provided test scripts to verify Supabase connectivity

### Critical Development Workflow

#### Before Making Changes
1. **Always run the relevant test script first** to understand current behavior
2. **Check performance impact** for any particle/animation changes
3. **Verify authentication flows** with `node test-signup-flow.js`
4. **Test image optimization** with `node test-image-loading.js`
5. **Test API endpoints** locally before deploying to catch routing issues early

#### Code Patterns to Follow
- **Particle Components**: Always implement fallback strategy (WebGL → CSS → Static)
- **Image Components**: Use OptimizedImage with WebP preference and fallbacks
- **Authentication**: Follow the middleware pattern in `src/middleware.ts`
- **Data Loading**: Use cached functions from `src/lib/data.ts`
- **Types**: Import from centralized `src/types/index.ts`
- **API Routes**: Always export runtime configuration: `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`

#### Performance-Critical Areas
- **Particle Systems**: Test on various devices before committing
- **Image Loading**: Always provide fallback text and optimize formats
- **Database Queries**: Use RLS policies and test with different user states
- **Bundle Size**: Run bundle analysis after significant changes
- **API Routes**: Test both static and dynamic routes in production environment

#### Error Handling Patterns
- **Authentication Errors**: Graceful degradation to public content
- **Database Errors**: Fallback to cached data or static content
- **Image Loading Errors**: Show fallback text or placeholder
- **Performance Issues**: Automatic fallback to simpler components
- **API Route Failures**: Check if returning HTML 404 vs JSON error responses

#### Deployment Verification Checklist
1. **Local Build**: `npm run build` must succeed without TypeScript errors
2. **API Route Testing**: Test all dynamic API routes locally with `npm run dev`
3. **Vercel Deployment**: Use `vercel --prod` for production deployments
4. **Function Verification**: Check `vercel inspect [url]` to ensure serverless functions are created
5. **Endpoint Testing**: Test API endpoints with `curl` to verify JSON responses vs HTML 404s
6. **Rollback Strategy**: Keep previous working commit hash for emergency rollbacks

# Using Gemini CLI for Large Codebase Analysis

When analyzing large codebases or multiple files that might exceed context limits, use the Gemini CLI with its massive context window. Use `gemini -p` to leverage Google Gemini's large context capacity.

## File and Directory Inclusion Syntax

Use the `@` syntax to include files and directories in your Gemini prompts. The paths should be relative to WHERE you run the gemini command:

### Examples:

**Single file analysis:**
```bash
gemini -p "@src/main.py Explain this file's purpose and structure"
```

**Multiple files:**
```bash
gemini -p "@package.json @src/index.js Analyze the dependencies used in the code"
```

**Entire directory:**
```bash
gemini -p "@src/ Summarize the architecture of this codebase"
```

**Multiple directories:**
```bash
gemini -p "@src/ @tests/ Analyze test coverage for the source code"
```

**Current directory and subdirectories:**
```bash
gemini -p "@./ Give me an overview of this entire project"
# Or use --all_files flag:
gemini --all_files -p "Analyze the project structure and dependencies"
```

### Implementation Verification Examples

Check if a feature is implemented:
```bash
gemini -p "@src/ @lib/ Has dark mode been implemented in this codebase? Show me the relevant files and functions"
```

Verify authentication implementation:
```bash
gemini -p "@src/ @middleware/ Is JWT authentication implemented? List all auth-related endpoints and middleware"
```

Check for specific patterns:
```bash
gemini -p "@src/ Are there any React hooks that handle WebSocket connections? List them with file paths"
```

Verify error handling:
```bash
gemini -p "@src/ @api/ Is proper error handling implemented for all API endpoints? Show examples of try-catch blocks"
```

### When to Use Gemini CLI

Use gemini -p when:
- Analyzing entire codebases or large directories
- Comparing multiple large files
- Need to understand project-wide patterns or architecture
- Current context window is insufficient for the task
- Working with files totaling more than 100KB
- Verifying if specific features, patterns, or security measures are implemented
- Checking for the presence of certain coding patterns across the entire codebase

### Important Notes

- Paths in @ syntax are relative to your current working directory when invoking gemini
- The CLI will include file contents directly in the context
- No need for --yolo flag for read-only analysis
- Gemini's context window can handle entire codebases that would overflow Claude's context
- When checking implementations, be specific about what you're looking for to get accurate results

# Important Instruction Reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

## Common Build Issues and Solutions

### Rate Limiter Configuration Errors
- **Problem**: `RATE_LIMIT_CONFIGS.API` does not exist error during build
- **Solution**: Use the correct configuration name from the available options:
  - `RATE_LIMIT_CONFIGS.GENERAL_API` - for standard API endpoints
  - `RATE_LIMIT_CONFIGS.ADMIN_API` - for admin operations
  - `RATE_LIMIT_CONFIGS.AUTH_API` - for authentication endpoints
- **Root Cause**: The rate limiter system uses specific predefined configurations, not a generic `API` config

### Supabase Client Method Usage
- **Problem**: TypeScript errors with Supabase query methods
- **Solution**: Use correct method signatures:
  - `.select()` instead of `.select('*', { options })` for simple queries
  - Use `.data.length` instead of `.count` for row count after updates
  - Service role key is required for admin operations that bypass RLS

### Admin Member Management Issues
- **Problem**: Member approval returns success but doesn't update database
- **Solution**: Ensure `SUPABASE_SERVICE_ROLE_KEY` is properly configured in both local `.env.local` and Vercel environment variables
- **Debugging**: Check server logs for "NO_ROWS_UPDATED" errors which indicate RLS policy blocks

### TypeScript Build Errors After Package Updates
- **Problem**: Supabase client methods returning `unknown` types, causing build failures
- **Solution**: Use type assertions `(data as any)` for Supabase query results when types are incorrectly inferred
- **Temporary Fix**: Set `typescript: { ignoreBuildErrors: true }` in `next.config.js` for urgent deployments
- **Root Cause**: Package version mismatches between @supabase packages and Next.js

### Dynamic API Route 404 Issues in Production
- **Problem**: Dynamic API routes like `/api/posts/[id]/likes` return HTML 404 pages instead of JSON responses in production
- **Solution**: 
  - Verify serverless functions are created during Vercel build: `vercel inspect [deployment-url]`
  - Check function deployment logs: `vercel inspect [deployment-url] --logs`
  - Test static vs dynamic routes: Static routes (`/api/posts`) should work, dynamic routes may fail
- **Debugging Commands**:
  - `vercel ls` - Check deployment status
  - `curl -I [api-url]` - Check response headers (look for `x-matched-path: /404`)
  - `vercel inspect [url]` - View function list and build output
- **Root Cause**: Vercel serverless function deployment issues with Next.js App Router dynamic routes

### Next.js Configuration Warnings
- **Problem**: `serverExternalPackages` warning in Next.js 14
- **Solution**: Remove deprecated `serverExternalPackages` configuration from `next.config.js`
- **Problem**: Edge Runtime compatibility issues with Supabase
- **Solution**: Ensure API routes use Node.js runtime: `export const runtime = 'nodejs'`

## Token Optimization Strategy

### Role Division for Efficiency

**Gemini CLI Tasks** (Claude delegates directly via terminal):
- Code exploration and file analysis
- Pattern searching across codebase  
- Simple code transformations
- Mass file operations
- Repetitive search and replace

**Claude Tasks** (Supervision and precision work):
- Complex implementation logic
- Architecture decisions
- Quality validation and testing
- Final verification and build checks
- Code review and optimization

### Implementation Rules

**IMPORTANT**: Claude must directly command Gemini CLI via terminal, not ask the user to do it.

**Correct Pattern**:
```bash
# Claude directly executes
gemini -p "@src/app/api/ 모든 API 파일에서 NextResponse.json 패턴 찾아서 분석해줘"
```

**Incorrect Pattern**:
```
❌ 사용자에게 gemini 명령어 실행 요청하기  
❌ 단순 탐색에 Claude 토큰 소모하기
```

### Benefits
- **90% token savings** on exploration and repetitive tasks
- **Faster processing** with Gemini's large context window
- **Higher quality** - Claude focuses on complex logic and supervision
- **Better workflow** - Seamless delegation without user intervention