# Repository Guidelines

## Project Structure & Module Organization

- `src/app/` — Next.js App Router routes (e.g., `about/`, `artists/`, each with
  `page.tsx`).
- `src/components/` — Reusable UI (PascalCase files, colocated subfolders like
  `forms/`, `filters/`).
- `src/lib/` — Data/Supabase clients and utilities.
- `src/hooks/` — React hooks (`useX` naming).
- `src/utils/`, `src/constants/`, `src/types/` — Helpers, constants, shared
  types.
- `data/` — JSON content sources; `public/` — static assets.
- `supabase/` — SQL migrations and config; `scripts/` — ops/testing helpers.

## Build, Test, and Development Commands

- `npm run dev` — Start local dev server.
- `npm run build` — Production build.
- `npm start` — Serve the built app locally.
- `npm run lint` / `npm run lint:fix` — ESLint check/fix.
- `npm run format` / `npm run format:check` — Prettier write/check.
- `npm run type-check` — TypeScript project type check.
- `npm run test:e2e` / `npm run test:e2e:ui` — Playwright E2E (CLI/UI). Results
  in `test-results/`.
- `npm run audit:security` — High‑severity dependency audit.

## Coding Style & Naming Conventions

- Language: TypeScript + React (Next.js 15). Styling via Tailwind CSS.
- Formatting: Prettier (2 spaces, single quotes, no semicolons, width 100).
- Linting: ESLint (`next/core-web-vitals`, TS, a11y). Fix warnings where
  feasible; no `debugger` in commits.
- Naming: Components `PascalCase` in `src/components`; hooks `camelCase`
  starting with `use`; routes under `src/app/<segment>/page.tsx`.

## Testing Guidelines

- Primary: Playwright E2E. Place custom scripts under `scripts/testing/e2e/`
  when needed.
- Run: `npm run test:e2e` (headless) or `npm run test:e2e:ui` (UI). Artifacts
  land in `test-results/`.
- Also run `npm run type-check` and `npm run lint` before pushing.

## Commit & Pull Request Guidelines

- Conventional Commits enforced (Husky + Commitlint). Examples:
  - `feat(auth): add signup flow`
  - `fix(api): handle missing auth header`
- PRs: clear description, link issues, screenshots for UI changes, list notable
  decisions.
- Required: green `lint`, `type-check`, and relevant E2E tests.

## Security & Configuration Tips

- Never commit secrets. Use `.env.local` (see README for required keys:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only keys,
  etc.).
- When touching middleware or APIs (rate limiting, CSP, uploads), run E2E and
  verify headers/limits.
- Deployment via Vercel; use `vercel` scripts only if authorized.
