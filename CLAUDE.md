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
  - `node check-supabase-status.js` - Verify Supabase connection and database status

### Vercel Commands
- `npm run vercel:build` - Build for Vercel deployment
- `npm run vercel:deploy` - Deploy to production
- `npm run vercel:preview` - Deploy preview version

### Additional Commands
- `npm run deploy` - Trigger manual deployment via webhook
- `npm run deploy:notify` - Send deployment notification to Slack

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
- `member_profiles` - User registration and approval status
- `posts` - Member board posts with categories (공지, 잡담, 홍보, 건의)
- `comments` - Nested comments on posts

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

### Component Architecture
Components are organized by purpose:
- **Layout**: Navigation, Footer, Hero sections
- **Content**: ArticleCard, FeaturedProjects, FeaturedArtists
- **Media**: OptimizedImage, YouTubeEmbed, Lightbox
- **Interactive**: TicketingCard with external links
- **Board System**: PostList, CreatePostForm, CommentSection

### Image Optimization
- All images stored in `/public/images/` with organized subdirectories
- Both original and WebP formats maintained
- Next.js Image component used with aggressive optimization settings
- Custom OptimizedImage component handles fallbacks

### Styling System
- Custom Tailwind theme with primary/accent color palettes
- Korean typography support with Pretendard and Noto Serif KR fonts
- Responsive design with mobile-first approach
- Custom animations for floating elements and smooth transitions

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

### TypeScript Configuration
- Strict mode enabled with comprehensive type checking
- Path mapping configured for clean imports
- Next.js plugin integrated for optimal builds

### Environment Variables Required
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase public API key
- `SUPABASE_SERVICE_ROLE_KEY` - For server-side operations (if needed)

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

# Using Gemini CLI for Large Codebase Analysis

  When analyzing large codebases or multiple files that might exceed context limits, use the Gemini CLI with its massive
  context window. Use `gemini -p` to leverage Google Gemini's large context capacity.

  ## File and Directory Inclusion Syntax

  Use the `@` syntax to include files and directories in your Gemini prompts. The paths should be relative to WHERE you run the
   gemini command:

  ### Examples:

  **Single file analysis:**
  ```bash
  gemini -p "@src/main.py Explain this file's purpose and structure"

  Multiple files:
  gemini -p "@package.json @src/index.js Analyze the dependencies used in the code"

  Entire directory:
  gemini -p "@src/ Summarize the architecture of this codebase"

  Multiple directories:
  gemini -p "@src/ @tests/ Analyze test coverage for the source code"

  Current directory and subdirectories:
  gemini -p "@./ Give me an overview of this entire project"
  
#
 Or use --all_files flag:
  gemini --all_files -p "Analyze the project structure and dependencies"

  Implementation Verification Examples

  Check if a feature is implemented:
  gemini -p "@src/ @lib/ Has dark mode been implemented in this codebase? Show me the relevant files and functions"

  Verify authentication implementation:
  gemini -p "@src/ @middleware/ Is JWT authentication implemented? List all auth-related endpoints and middleware"

  Check for specific patterns:
  gemini -p "@src/ Are there any React hooks that handle WebSocket connections? List them with file paths"

  Verify error handling:
  gemini -p "@src/ @api/ Is proper error handling implemented for all API endpoints? Show examples of try-catch blocks"

  Check for rate limiting:
  gemini -p "@backend/ @middleware/ Is rate limiting implemented for the API? Show the implementation details"

  Verify caching strategy:
  gemini -p "@src/ @lib/ @services/ Is Redis caching implemented? List all cache-related functions and their usage"

  Check for specific security measures:
  gemini -p "@src/ @api/ Are SQL injection protections implemented? Show how user inputs are sanitized"

  Verify test coverage for features:
  gemini -p "@src/payment/ @tests/ Is the payment processing module fully tested? List all test cases"

  When to Use Gemini CLI

  Use gemini -p when:
  - Analyzing entire codebases or large directories
  - Comparing multiple large files
  - Need to understand project-wide patterns or architecture
  - Current context window is insufficient for the task
  - Working with files totaling more than 100KB
  - Verifying if specific features, patterns, or security measures are implemented
  - Checking for the presence of certain coding patterns across the entire codebase

  Important Notes

  - Paths in @ syntax are relative to your current working directory when invoking gemini
  - The CLI will include file contents directly in the context
  - No need for --yolo flag for read-only analysis
  - Gemini's context window can handle entire codebases that would overflow Claude's context
  - When checking implementations, be specific about what you're looking for to get accurate results # Using Gemini CLI for Large Codebase Analysis


  When analyzing large codebases or multiple files that might exceed context limits, use the Gemini CLI with its massive
  context window. Use `gemini -p` to leverage Google Gemini's large context capacity.


  ## File and Directory Inclusion Syntax


  Use the `@` syntax to include files and directories in your Gemini prompts. The paths should be relative to WHERE you run the
   gemini command:


  ### Examples:


  **Single file analysis:**
  ```bash
  gemini -p "@src/main.py Explain this file's purpose and structure"


  Multiple files:
  gemini -p "@package.json @src/index.js Analyze the dependencies used in the code"


  Entire directory:
  gemini -p "@src/ Summarize the architecture of this codebase"


  Multiple directories:
  gemini -p "@src/ @tests/ Analyze test coverage for the source code"


  Current directory and subdirectories:
  gemini -p "@./ Give me an overview of this entire project"
  # Or use --all_files flag:
  gemini --all_files -p "Analyze the project structure and dependencies"


  Implementation Verification Examples


  Check if a feature is implemented:
  gemini -p "@src/ @lib/ Has dark mode been implemented in this codebase? Show me the relevant files and functions"


  Verify authentication implementation:
  gemini -p "@src/ @middleware/ Is JWT authentication implemented? List all auth-related endpoints and middleware"


  Check for specific patterns:
  gemini -p "@src/ Are there any React hooks that handle WebSocket connections? List them with file paths"


  Verify error handling:
  gemini -p "@src/ @api/ Is proper error handling implemented for all API endpoints? Show examples of try-catch blocks"


  Check for rate limiting:
  gemini -p "@backend/ @middleware/ Is rate limiting implemented for the API? Show the implementation details"


  Verify caching strategy:
  gemini -p "@src/ @lib/ @services/ Is Redis caching implemented? List all cache-related functions and their usage"


  Check for specific security measures:
  gemini -p "@src/ @api/ Are SQL injection protections implemented? Show how user inputs are sanitized"


  Verify test coverage for features:
  gemini -p "@src/payment/ @tests/ Is the payment processing module fully tested? List all test cases"


  When to Use Gemini CLI


  Use gemini -p when:
  - Analyzing entire codebases or large directories
  - Comparing multiple large files
  - Need to understand project-wide patterns or architecture
  - Current context window is insufficient for the task
  - Working with files totaling more than 100KB
  - Verifying if specific features, patterns, or security measures are implemented
  - Checking for the presence of certain coding patterns across the entire codebase


  Important Notes


  - Paths in @ syntax are relative to your current working directory when invoking gemini
  - The CLI will include file contents directly in the context
  - No need for --yolo flag for read-only analysis
  - Gemini's context window can handle entire codebases that would overflow Claude's context
  - When checking implementations, be specific about what you're looking for to get accurate results