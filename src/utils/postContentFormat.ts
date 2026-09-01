/**
 * `posts.content_format`으로 받아들이는 값의 allowlist.
 *
 * 스키마(`src/db/schema/content.ts`)에는 CHECK 제약이 없다 — 이 판정이
 * 유일한 검증 지점이다(`src/app/api/posts/[id]/route.ts` PATCH가 쓴다).
 *
 * `'markdown'`은 관리자가 직접 만드는 값이 아니라 `src/lib/server/grantPublish.ts:129`가
 * 지원사업 회차를 발행할 때 `createPost`(쿼리 계층, 이 라우트를 거치지 않는다)로
 * 직접 써넣는 값이다. 이 라우트는 그렇게 만들어진 게시글을 **편집(PATCH)할 때**
 * 이 값을 다시 만난다 — `EditPageClient.tsx`가 편집기가 관리하지 않는
 * content_format을 그대로 보존해 되돌려 보내기 때문이다. 여기서 빠지면
 * 관리자가 오타 하나만 고쳐도 "본문 형식이 올바르지 않습니다"로 저장 자체가
 * 400으로 실패한다.
 *
 * 이 파일은 `next/server` 등 Next 전용 모듈을 임포트하지 않는다 — route.ts는
 * 세션·rate limiter·DB를 다 세워야 단위 테스트로 부를 수 있어(구조 검사로
 * 대신하는 `scripts/testing/postCutoverWriteGuards.test.mjs`와 같은 이유)
 * 직접 임포트가 안 되므로, 이 판정만 별도 파일로 떼어내 인증 없이 직접
 * 검증할 수 있게 한다.
 */
export type AllowedPostContentFormat = 'plain' | 'html' | 'markdown'

export function parsePostContentFormat(value: unknown): AllowedPostContentFormat | null {
  return value === 'plain' || value === 'html' || value === 'markdown' ? value : null
}
