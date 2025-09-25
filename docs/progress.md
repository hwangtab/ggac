# Repository Progress Log

## Recent Changes

- Updated the OptimizedImage component to share the exact quality allow-list
  with `next.config.js`, added automatic fallbacks (WebP→JPEG/PNG→default
  avatar), and tuned fetch priority so images load reliably on mobile networks.
- Re-pointed the themilliways Supabase profile to the latest uploaded WebP
  variant and tightened the loading skeleton overlay so lazy loaders stay
  centered within cards.
- Updated the admin artist assignment API to use a Supabase service-role client,
  so member verification and updates bypass RLS and no longer return 404 "멤버를
  찾을 수 없습니다" errors during assignment.
- Investigated `/artists` image regressions and confirmed Supabase
  `artists.profile_photo_url` entries still point to legacy repo assets or
  `NULL`, so new storage uploads never reach the frontend rendering pipeline.
- Rebuilt the board list and detail bootstrap paths so the server now hands
  initial post data directly to the client components, eliminating brittle DOM
  script probes and the associated hydration failures.
- Removed the legacy `profile_image` column and unified all artist image
  references around `profile_photo_url`.
- Updated fallback JSON (`data/artists.json`) to reference the latest
  Supabase-hosted profile images, preventing build-time regressions when
  Supabase lookups fail.
- Refined the artist photo upload flow to invalidate caches and surface a single
  inline success message instead of multiple browser alerts.
- Removed the layout-level CSS script guard that was interfering with hydration,
  unblocking client-side rendering of dynamic pages such as the board.

## Next Steps

1. Smoke-test `/artists`, `/archive`, 그리고 주요 랜딩 섹션을
   모바일/데스크톱에서 확인해 신규 이미지 폴백 체인이 정상 동작하는지 검증하고,
   Lighthouse로 LCP/CLS 변화를 기록.
2. Verify on staging and production that admin users can assign and unassign
   artist members without triggering RLS-related 404 errors, and capture
   Supabase logs if anomalies persist.
3. Backfill `artists.profile_photo_url` (and `profile_photo_metadata`) with the
   actual Supabase public URLs for the affected rows, or re-run the upload flow
   per artist to persist the metadata.
4. Re-run `/artists` after backfill and ensure `OptimizedImage` no longer shows
   error fallbacks; confirm CDN cache invalidation is not required once URLs
   change.
5. Verify in production that `/board` list and detail pages hydrate correctly
   with the new server hand-offs and capture any residual `errorId`/`digest`
   references from Vercel if issues persist.
6. Once `/board` stabilises, run a regression pass on other ISR pages
   (`/archive`, `/artists/[slug]`) to confirm there are no lingering static
   fallbacks.
