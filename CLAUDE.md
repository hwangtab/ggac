# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm run dev` - Start development server on localhost:3000
- `npm run build` - Build production version
- `npm run start` - Start production server
- `npm run lint` - Run ESLint for code quality checks

### Vercel Commands
- `npm run vercel:build` - Build for Vercel deployment
- `npm run vercel:deploy` - Deploy to production
- `npm run vercel:preview` - Deploy preview version

## Architecture Overview

This is a **Next.js 14 App Router** application for 경기아트콜렉티브 협동조합 (Gyeonggi Art Collective Cooperative). The site showcases artists, projects, and cooperative activities.

### Key Technologies
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript with strict mode
- **Styling**: Tailwind CSS with custom design system
- **Animation**: Framer Motion for smooth interactions
- **State Management**: Zustand for global state
- **Content**: Markdown support via react-markdown
- **Deployment**: Vercel with static site generation

### Data Architecture
All content is managed through JSON files in the `/data` directory:
- `artists.json` - Artist profiles and information
- `projects.json` - Project details and media
- `global.json` - Site-wide configuration and contact info

Data is accessed through cached functions in `src/lib/data.ts` which provide both async and sync versions for different use cases.

### Route Structure
- `/` - Home page with featured content
- `/about` - Cooperative story and philosophy
- `/archive` - Project gallery with filtering
- `/artists` - Artist directory with individual profiles
- `/connect` - Contact and membership information

### Component Architecture
Components are organized by purpose:
- **Layout**: Navigation, Footer, Hero sections
- **Content**: ArticleCard, FeaturedProjects, FeaturedArtists
- **Media**: OptimizedImage, YouTubeEmbed, Lightbox
- **Interactive**: TicketingCard with external links

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
- JSON-based content system for easy updates
- Structured data types with TypeScript interfaces
- Cached data loading for performance
- Static generation for all pages

## Development Notes

### Path Aliases
- `@/*` maps to `src/*` for cleaner imports

### TypeScript Configuration
- Strict mode enabled with comprehensive type checking
- Path mapping configured for clean imports
- Next.js plugin integrated for optimal builds

### Build Requirements
- Node.js 18+ required
- All builds must pass TypeScript compilation
- ESLint must pass without errors before deployment

### Deployment
- Automatic deployment via Vercel on push to main branch
- Environment variables configured in Vercel dashboard
- Custom domain: https://ggac.kr