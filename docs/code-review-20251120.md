# 코드 리뷰 (2025-11-20)

## 1. 서비스 롤 키를 사용하는 공개 API

- **설명:** 게시판/프로필 관련 다수의 GET 엔드포인트가 `createClient`에
  `SUPABASE_SERVICE_ROLE_KEY`를 주입한 채 누구에게나 응답하고 있습니다.
  (`src/app/api/posts/public/route.ts:10-99`,
  `src/app/api/posts/[id]/content/route.ts:8-34`,
  `src/app/api/posts/[id]/comments/route.ts:12-93`,
  `src/app/api/board/post/[id]/route.ts:9-84`,
  `src/app/api/profiles/route.ts:1-44` 등)
- **영향:** 서비스 롤 키는 RLS를 완전히 우회하므로, 익명 사용자가 비공개
  게시글/댓글/프로필을 포함한 모든 데이터를 열람할 수 있고, 키가 노출될 경우
  쓰기 권한까지 탈취될 수 있습니다. 특히 Edge 런타임에 올라간 함수는 글로벌
  POP에 복제되므로 공격 표면이 더 넓습니다.
- **개선 제안:** 공개 데이터는 Supabase `anon` 키 + RLS 정책으로 제한하고, 서버
  액션/Route Handler에서는 `createRouteHandlerClient`를 통해 사용자 세션을
  주입한 뒤 필요한 최소 권한만 조회하도록 바꿔야 합니다. 서비스 롤 키 사용이
  불가피한 관리자 전용 API라면 인증/인가를 선행하고, 일반 사용자가 호출할 수
  있는 경로에서는 절대 서비스 롤 키를 사용하지 않도록 환경 변수를 분리하세요.

## 2. `/api/media/upload` GET 경로 불일치

- **설명:** 업로드는 `attachments/${userId}/파일명` 형태로
  저장하지만(`src/app/api/media/upload/route.ts:122-150`), GET에서는
  `${session.user.id}/`만 조회·URL 생성에
  사용합니다(`src/app/api/media/upload/route.ts:536-600`). 동일한 prefix를 쓰지
  않으므로 목록이 비어 보이거나 잘못된 URL이 내려갈 수 있습니다.
- **영향:** 상황에 따라 이미 업로드된 파일이 노출되지 않아 “업로드 후 즉시 선택”
  같은 플로우가 실패합니다. 치명적 보안 이슈는 아니지만, Storage와 UI 사이
  동기화가 깨져 사용성이 크게 나빠질 수 있습니다.
- **개선 제안:** 업로드/조회 경로를 동일한 헬퍼에서 파생시키거나, GET에서도
  `attachments/${userId}`·`profiles/${userId}`를 기준으로
  `.list()`/`getPublicUrl()`을 호출하도록 정리해 주세요.

## 3. MediaManager 업로드 콜백에 최신 상태가 누락됨

- **설명:** `startUpload`가 끝난 뒤 `completedFiles` 스냅샷을 그대로
  `onUploadComplete`에 넘기는데(`src/components/MediaManager.tsx:216-279`),
  클로저에 캡처된 값에는 방금 업로드한 항목이 포함되지 않습니다.
- **영향:** 업로드 자체는 성공하지만, 콜백이 “업로드 직후 리스트” 대신 이전
  상태만 전달받아 상위 컴포넌트가 최신 썸네일/파일 정보를 반영하지 못합니다.
- **개선 제안:** 업로드 루프에서 `newlyUploaded` 배열을 누적하거나
  `setCompletedFiles`의 최신 반환값을 활용해 콜백에 최신 배열을 넘기도록
  수정하세요. 예:
  `const uploaded: MediaFile[] = []; … uploaded.push(uploadedFile); … onUploadComplete?.([...completedFiles, ...uploaded])`.

---

### 추가 추천

- 서비스 롤 키를 사용하는 모든 Route Handler를 한 번에
  검색(`rg "SUPABASE_SERVICE_ROLE_KEY" src/app/api`)하여 인증·인가 요건을
  점검하고, Edge 함수에선 반드시 익명 키만 사용하도록 가드 코드를 추가해 주세요.
