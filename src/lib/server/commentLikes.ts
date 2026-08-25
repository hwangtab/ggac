import { getLikedCommentIds } from '@/db/queries/likes'

/**
 * 단계 2c(Task 6): `comment_likes` 배치 조회를 Supabase에서 Turso 쿼리
 * 계층(`getLikedCommentIds`)으로 옮겼다. `SupabaseClient` 인자가 더 이상
 * 필요 없어(권한 판정도 이 함수가 하지 않는다 — 호출부가 이미 로그인 사용자
 * `userId`를 확인한 뒤 넘긴다) 시그니처에서 뺐다.
 *
 * **에러 처리가 바뀐다(의도적):** 옛 Supabase 구현은 조회 실패(`error` 존재)를
 * 조용히 삼키고 빈 `Set`을 돌려줬다. `getLikedCommentIds`(쿼리 계층)는 이
 * 저장소의 다른 모든 쿼리 함수(`posts.ts`/`attachments.ts`/`profiles.ts`)와
 * 같은 계약을 따른다 — DB 조회 자체가 실패하면 삼키지 않고 그대로 throw한다.
 * 호출부(`comments/route.ts`, `comments-list/route.ts`)가 이미 요청 전체를
 * try/catch로 감싸고 있어, 실패 시 "좋아요 상태 없이 조용히 200" 대신
 * 500으로 드러난다 — 장애를 숨기지 않는 쪽이 이 저장소의 일관된 원칙이다.
 * `commentIds`가 비어 있으면(정상 케이스) 여전히 DB 왕복 없이 즉시 빈 `Set`을
 * 돌려준다.
 */
export async function getUserLikedCommentIds(
  userId: string,
  commentIds: string[]
): Promise<Set<string>> {
  return getLikedCommentIds(userId, commentIds)
}
