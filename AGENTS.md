# Repository Guidelines

## Project Structure & Module Organization

- Core app code lives in `src/`, with routes under `src/app/<segment>/page.tsx`.
- Shared UI components belong in `src/components/ComponentName/`, hooks in
  `src/hooks/`, and data helpers in `src/lib/` or `src/utils/`.
- Fixtures and mock data sit in `data/`, static assets in `public/`, Playwright
  artifacts in `test-results/`, and operational scripts in `scripts/`.
- Track ongoing work in `docs/progress.md`; update it after every notable task.

## Build, Test, and Development Commands

- `npm run dev` — start the Next.js dev server with hot reload.
- `npm run build` followed by `npm start` — produce and serve the production
  bundle.
- `npm run lint`, `npm run lint:fix` — check or auto-fix ESLint issues.
- `npm run format`, `npm run format:check` — run Prettier or verify formatting.
- `npm run type-check` — validate TypeScript types.
- `npm run test:e2e` or `npm run test:e2e:ui` — execute Playwright suites
  (headless or with UI).
- `npm run audit:security` — scan dependencies for known vulnerabilities.

## Coding Style & Naming Conventions

- Write TypeScript/React with Tailwind; avoid `any` unless justified.
- Prettier enforces 2-space indentation, single quotes, no semicolons,
  100-character lines.
- Components use PascalCase, hooks use camelCase starting with `use`, route
  directories stay lowercase.
- Keep complex variants colocated with their component folder; avoid `debugger`
  statements.

## Testing Guidelines

- Use Playwright for end-to-end coverage; keep spec helpers under
  `scripts/testing/e2e/`.
- Run `npm run lint`, `npm run type-check`, and at least one Playwright command
  before pushing.
- Configure retries for flaky scenarios and inspect artifacts in `test-results/`
  when debugging failures.
- Name specs descriptively (e.g., `checkout.spec.ts`) and scope fixtures near
  the tests they support.

## Commit & Pull Request Guidelines

- Follow Conventional Commits (e.g., `feat(auth): add signup flow`,
  `fix(api): handle missing auth header`).
- PRs require concise summaries, linked issues, and screenshots for UI updates.
- Call out schema or architectural changes explicitly and confirm lint,
  type-check, and Playwright jobs pass.

## Security & Configuration Tips

- Never commit secrets; store Supabase and Vercel keys in `.env.local`.
- Re-run Playwright when touching auth, middleware, or Supabase policies; verify
  response headers locally.
- Document new environment variables in the README and avoid echoing sensitive
  values in logs.
