# Repository Progress Log

## Recent Changes

- Added the 사바하 라이브 영상 촬영 기록을 `data/projects.json`에 등록하고, 대표
  이미지(1280×721 PNG), 상세 갤러리, YouTube 임베드 섹션을 포함하도록 프로젝트
  상세 UI를 확장.
- Corrected the 사바하 라이브 영상 촬영 프로젝트의 공개 날짜(2025-10-12)와 대표
  이미지 경로를 롱플레이어 촬영 장면(`IMG_6060.webp`)으로 조정.
- Updated the 사바하 라이브 영상 촬영 현장 스케치 복기 내용을 실제 작업 흐름과
  뒷풀이 분위기에 맞게 수정.
- Re-classified the 사바하 라이브 영상 촬영 프로젝트를 `행사` 카테고리로 조정해
  아카이브 목록 필터와 정렬이 실제 진행 맥락과 맞춰지도록 함.
- Added the '펑크포크 & 블루스' 공연 홍보 프로젝트, including Markdown copy,
  event details, Yoo Dong Hyuk linkage, DOT 인스타그램 DM 예매 정보, and the
  공식 뉴스아트 기사 링크를 `data/projects.json`에 반영.
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

1. Source or export the official poster to `/public/images/projects/` and update
   the cover image to match once usage rights are confirmed.
2. QA `/archive/punkfolk-blues-dot-2025` and 유동혁 아티스트 상세 페이지에서 새
   프로젝트 카드가 올바르게 표시되는지 확인.
