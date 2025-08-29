# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npx playwright test             # E2E testing
ANALYZE=true npm run build      # Bundle size analysis
```

### Deployment
```bash
npm run vercel:deploy           # Vercel production deployment
npm run vercel:preview          # Vercel preview deployment
npm run deploy                  # Deploy webhook trigger
npm run deploy:notify           # Deploy notification script
```

### Post-Task Checklist
After completing any development task:
1. Run `npm run lint` - fix all ESLint errors
2. Run `npm run build` - ensure build succeeds
3. Test locally at http://localhost:3000
4. Only commit if all checks pass

## Architecture Overview

This is a **Next.js 15 App Router** project for 경기아트콜렉티브 협동조합 (Gyeonggi Art Collective Cooperative).

### Key Technologies
- **Framework**: Next.js 15.4.4 (App Router) + React 19
- **Language**: TypeScript (strict: false for gradual migration)
- **Styling**: Tailwind CSS + custom particle systems (WebGL/Canvas)
- **Backend**: Next.js API routes + Supabase
- **Database**: Supabase PostgreSQL
- **Auth**: Supabase Auth with role-based access control
- **Rich Text**: React Quill editor + react-markdown
- **Testing**: Playwright E2E testing
- **Deployment**: Vercel with automatic deployments

### Data Management Strategy
- **Static Content**: JSON files in `/data/` directory (artists.json, projects.json, global.json)
- **Dynamic Content**: Supabase database (users, posts, comments, notifications)
- **Images**: Static files in `/public/images/` with WebP optimization

### Critical Components
- `OptimizedImage.tsx` - Advanced image loading with WebP → JPEG → JPG → PNG fallback chain
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
All API routes should use standardized responses:
```typescript
// Success
return createSuccessResponse(data)

// Error responses
return createErrorResponse('Error message', 400)
return createErrorResponse('Login required', 401)

// Specialized error handlers
import { createAuthError, createForbiddenError } from '@/utils/apiErrorHandler'
throw createAuthError('Login required')
throw createForbiddenError('Access denied')
```

### Authentication Flow
- Supabase Auth integration via middleware
- Role-based access (admin/user permissions)
- Session management in middleware.ts

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

This codebase emphasizes user experience through advanced image optimization, comprehensive error handling, and performance-focused architecture while maintaining security best practices.