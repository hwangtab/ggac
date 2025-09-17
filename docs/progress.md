# Repository Progress Log

## Recent Changes

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

1. Verify in production that `/board` list and detail pages hydrate correctly
   with the new server hand-offs and capture any residual `errorId`/`digest`
   references from Vercel if issues persist.
2. Confirm that `/artists` renders Supabase-hosted images after the latest
   deployment and purge any stale CDN cache if required.
3. Once `/board` stabilises, run a regression pass on other ISR pages
   (`/archive`, `/artists/[slug]`) to confirm there are no lingering static
   fallbacks.
4. Document any additional findings and update this log with outcomes and new
   action items.
