# Repository Guidelines

## Project Structure & Module Organization

Keep features modular under `src/`. Routes live in `src/app/<segment>/page.tsx`,
while reusable UI belongs in `src/components/ComponentName/`. Data access sits
in `src/lib/`, custom hooks in `src/hooks/`, and shared helpers in `src/utils/`,
`src/constants/`, and `src/types/`. JSON fixtures live in `data/`, static assets
in `public/`, and Supabase migrations under `supabase/`. Operational scripts
reside in `scripts/`, and Playwright artifacts land in `test-results/`.

## Build, Test, and Development Commands

Use `npm run dev` for the Next.js dev server and hot reload. `npm run build`
produces the production bundle, and `npm start` serves the compiled build. Run
`npm run lint` or `npm run lint:fix` for ESLint, `npm run format` or
`npm run format:check` for Prettier, and `npm run type-check` to verify
TypeScript. End-to-end suites execute with `npm run test:e2e` (headless) or
`npm run test:e2e:ui` (Playwright UI). Security audits run via
`npm run audit:security`.

## Coding Style & Naming Conventions

Write TypeScript and React components using Tailwind CSS for styling. Prettier
enforces 2-space indentation, single quotes, no semicolons, and a 100-character
line width. Keep components in PascalCase, hooks in camelCase starting with
`use`, and route directories lowercase. Co-locate complex component variants or
forms within their component folder. Avoid `debugger` statements and resolve
lint warnings whenever possible.

## Testing Guidelines

Playwright drives browser coverage; keep specs colocated with supporting
fixtures under `scripts/testing/e2e/` when adding helpers. Before pushing, run
`npm run lint`, `npm run type-check`, and at least one of the Playwright
commands. Capture flaky scenarios with retries configured in the Playwright
settings, and inspect HTML/video artifacts in `test-results/` when debugging
failures.

## Commit & Pull Request Guidelines

Follow Conventional Commits enforced by Husky and Commitlint, e.g.
`feat(auth): add signup flow` or `fix(api): handle missing auth header`. Each PR
needs a concise summary, linked issues, and screenshots for UI changes. Confirm
that lint, type-check, and relevant Playwright jobs pass. Call out architectural
decisions or schema changes in the description so reviewers can focus on the
right areas.

## Security & Configuration Tips

Never commit secrets; keep required keys in `.env.local`
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only
secrets). When touching authentication, middleware, or Supabase policies, rerun
Playwright suites and verify response headers locally. Use Vercel deployment
scripts only when authorized, and document any new environment variables in the
README.

## Progress Tracking

Maintain an ongoing change log in `docs/progress.md`. After each significant
task or investigation, append the latest “Recent Changes” and refresh the “Next
Steps” so the document always reflects the current state of work.。
