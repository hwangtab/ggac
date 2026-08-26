/**
 * `post_likes`/`comment_likes` 쿼리 계층 (Turso/Drizzle). Task 6(`댓글·좋아요
 * 전환`)가 만든다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(로그인·승인 회원
 * 확인, 본인 좋아요만 토글)은 호출부(라우트, `requireActiveMember()`/
 * `requireUser()`)의 몫이다.
 *
 * **좋아요 수는 매번 재계산한다 — 절대 `+1`/`-1` 증감을 쓰지 않는다.** 운영
 * Postgres의 `post_likes`에는 트리거가 3개 걸려 있고 그중 2개가 같은 `+1` 함수를
 * 돈다(`update_post_like_count`, 그리고 `harden_security_definer_functions.sql`이
 * 다시 만든 `toggle_post_like` 함수 자체의 명시적 `UPDATE ... SET like_count =
 * (SELECT COUNT(*) ...)`). 지금 카운트가 맞는 유일한 이유는 마지막에 실행되는
 * `toggle_post_like`/`toggle_comment_like`(SECURITY DEFINER, 2026-05-06 강화판)가
 * 맨 끝에서 `COUNT(*)`로 통째로 덮어쓰기 때문이다 — 트리거의 ±1 결과를 사실상
 * 무시하고 마지막에 진짜 값으로 확정한다. `toggleCommentLike`의 원본
 * `20250724090050_create_comment_likes_table.sql`은 트리거만 ±1로 두고 재계산을
 * 하지 않았지만(댓글 좋아요는 게시글과 달리 마지막 덮어쓰기가 없었다), 이 결함을
 * 새 코드에 들여올 이유가 없다 — `togglePostLike`와 `toggleCommentLike` **둘 다**
 * 재계산 방식으로 통일한다.
 *
 * **트랜잭션 구조** (`togglePostLike`/`toggleCommentLike` 공통):
 * 1. 기존 좋아요 행 조회
 * 2. 있으면 DELETE, 없으면 INSERT
 * 3. `UPDATE posts/comments SET like_count = (SELECT COUNT(*) FROM
 *    post_likes/comment_likes WHERE post_id/comment_id = ?)`
 * 4. 갱신된 카운트를 반환
 *
 * 전부 `db.transaction()` 안에서 실행한다. `post_likes_post_user_idx(post_id,
 * user_id)`/`comment_likes_comment_user_idx(comment_id, user_id)` 유니크
 * 인덱스가 동시 요청에서 중복 행 생성을 막는다 — 두 번째 INSERT는 제약 위반으로
 * 거부된다(직접 재현: `scripts/testing/queriesLikes.test.mjs`).
 */

import { and, count, desc, eq, inArray } from 'drizzle-orm'

import { db } from '../client.ts'
import { comments, commentLikes, memberProfiles, postLikes, posts } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export interface ToggleLikeResult {
  liked: boolean
  like_count: number
}

/**
 * 게시글 좋아요를 토글한다. `toggle_post_like` RPC 대체 — 위 모듈 설명의
 * 트랜잭션 구조를 그대로 따른다. 게시글 존재/삭제 여부는 이 함수가 확인하지
 * 않는다(호출부가 이미 `getPostById`로 확인한다 — 존재하지 않는 `postId`를
 * 넘기면 `post_likes.post_id`의 FK 제약이 INSERT를 거부해 throw한다).
 */
export async function togglePostLike(postId: string, userId: string): Promise<ToggleLikeResult> {
  return db.transaction(async tx => {
    const existing = await tx
      .select({ id: postLikes.id })
      .from(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
      .limit(1)

    let liked: boolean
    if (existing[0]) {
      await tx.delete(postLikes).where(eq(postLikes.id, existing[0].id))
      liked = false
    } else {
      await tx.insert(postLikes).values({ postId, userId })
      liked = true
    }

    const [{ value: actualCount }] = await tx
      .select({ value: count() })
      .from(postLikes)
      .where(eq(postLikes.postId, postId))

    const [updated] = await tx
      .update(posts)
      .set({ likeCount: actualCount })
      .where(eq(posts.id, postId))
      .returning({ likeCount: posts.likeCount })

    return { liked, like_count: updated?.likeCount ?? actualCount }
  })
}

/**
 * 댓글 좋아요를 토글한다. `toggle_comment_like` RPC 대체 — `togglePostLike`와
 * 동일한 재계산 방식(위 모듈 설명 참고). 원본 Postgres 함수는 트리거의 ±1
 * 결과를 그대로 뒀지만, 이 함수는 의도적으로 `togglePostLike`와 같은 재계산
 * 패턴으로 통일한다(결함을 새 코드에 들여오지 않는다).
 */
export async function toggleCommentLike(
  commentId: string,
  userId: string
): Promise<ToggleLikeResult> {
  return db.transaction(async tx => {
    const existing = await tx
      .select({ id: commentLikes.id })
      .from(commentLikes)
      .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)))
      .limit(1)

    let liked: boolean
    if (existing[0]) {
      await tx.delete(commentLikes).where(eq(commentLikes.id, existing[0].id))
      liked = false
    } else {
      await tx.insert(commentLikes).values({ commentId, userId })
      liked = true
    }

    const [{ value: actualCount }] = await tx
      .select({ value: count() })
      .from(commentLikes)
      .where(eq(commentLikes.commentId, commentId))

    const [updated] = await tx
      .update(comments)
      .set({ likeCount: actualCount })
      .where(eq(comments.id, commentId))
      .returning({ likeCount: comments.likeCount })

    return { liked, like_count: updated?.likeCount ?? actualCount }
  })
}

/** 특정 사용자가 특정 게시글을 좋아요했는지. `/api/posts/[id]/likes` GET,
 * `/api/posts/[id]/user-data`가 쓴다(기존 `.from('post_likes').select('id')
 * .eq('post_id',...).eq('user_id',...).single()`/`.maybeSingle()` 대체). */
export async function isPostLikedByUser(postId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: postLikes.id })
    .from(postLikes)
    .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
    .limit(1)
  return rows.length > 0
}

/**
 * 여러 댓글 id 중 `userId`가 좋아요한 것들의 id 집합을 **한 쿼리**로 돌려준다
 * (N+1 아님, `inArray`). `commentIds`가 비면 쿼리 없이 즉시 빈 Set.
 *
 * 댓글 목록 라우트(`/api/posts/[id]/comments`, `.../comments-list`)가 직접
 * 부른다. 단계 2c에는 `src/lib/server/commentLikes.ts`의
 * `getUserLikedCommentIds`가 이 함수를 그대로 위임하는 래퍼로 남아 있었는데,
 * `SupabaseClient` 인자를 걷어낸 뒤로는 이름만 바꿔 넘기는 일 말고는 하는 일이
 * 없어 단계 4 Task 6b에서 지웠다.
 *
 * **조회 실패는 삼키지 않는다.** 옛 Supabase 구현은 `error`를 무시하고 빈
 * `Set`을 돌려줘 "좋아요 상태 없이 조용히 200"이 됐다. 이 함수는 이 저장소의
 * 다른 쿼리 함수와 같은 계약을 따라 그대로 throw하고, 호출부의 try/catch가
 * 500으로 드러낸다.
 */
export async function getLikedCommentIds(
  userId: string,
  commentIds: string[]
): Promise<Set<string>> {
  const uniqueIds = [...new Set(commentIds.filter(Boolean))]
  if (!userId || uniqueIds.length === 0) {
    return new Set()
  }
  const rows = await db
    .select({ commentId: commentLikes.commentId })
    .from(commentLikes)
    .where(and(eq(commentLikes.userId, userId), inArray(commentLikes.commentId, uniqueIds)))
  return new Set(rows.map(r => r.commentId))
}

/**
 * 여러 게시글 id 중 `userId`가 좋아요한 것들의 id 집합을 **한 쿼리**로
 * 돌려준다(N+1 아님, `inArray`) — `getLikedCommentIds`의 게시글판.
 * `postIds`가 비면 쿼리 없이 즉시 빈 Set(`inArray`에 빈 배열을 넘기면 SQLite
 * 방언에서 유효하지 않은 SQL이 되므로 이 저장소의 다른 배치 함수와 같은
 * 규칙으로 가드한다). `src/app/api/posts/route.ts` GET이 게시판 목록에서
 * "내가 좋아요한 글" 표시(`userLikedSet`)에 쓴다(기존
 * `.from('post_likes').select('post_id').eq('user_id',...).in('post_id',
 * postIds)` 대체).
 */
export async function getLikedPostIds(userId: string, postIds: string[]): Promise<Set<string>> {
  const uniqueIds = [...new Set(postIds.filter(Boolean))]
  if (!userId || uniqueIds.length === 0) {
    return new Set()
  }
  const rows = await db
    .select({ postId: postLikes.postId })
    .from(postLikes)
    .where(and(eq(postLikes.userId, userId), inArray(postLikes.postId, uniqueIds)))
  return new Set(rows.map(r => r.postId))
}

/** API 응답에 쓰이는 snake_case 정규화 형태. `get_user_likes` RPC와 같은 필드명
 * — 브리프가 그대로 유지하라고 명시한다(`src/types/board.ts`의 `UserLikedPost`와
 * 동일한 모양). */
export interface UserLikedPost {
  post_id: string
  post_title: string
  post_category: string
  post_author_name: string
  liked_at: string
}

export interface ListUserLikesFilter {
  limit: number
  offset: number
}

/**
 * 사용자가 좋아요한 게시글 목록. `get_user_likes` RPC 대체. 원본은
 * `post_likes → posts → member_profiles` 조인에 `p.is_deleted = false` 필터,
 * `ORDER BY pl.created_at DESC`다 — 그대로 옮긴다. 반환 필드명(`post_id`·
 * `post_title`·`post_category`·`post_author_name`·`liked_at`)도 그대로 유지한다.
 */
export async function listUserLikes(
  userId: string,
  filter: ListUserLikesFilter
): Promise<UserLikedPost[]> {
  const rows = await db
    .select({
      postId: postLikes.postId,
      postTitle: posts.title,
      postCategory: posts.category,
      postAuthorName: memberProfiles.displayName,
      likedAt: postLikes.createdAt,
    })
    .from(postLikes)
    .innerJoin(posts, eq(postLikes.postId, posts.id))
    .innerJoin(memberProfiles, eq(posts.authorId, memberProfiles.id))
    .where(and(eq(postLikes.userId, userId), eq(posts.isDeleted, false)))
    .orderBy(desc(postLikes.createdAt))
    .limit(filter.limit)
    .offset(filter.offset)

  return rows.map(row => ({
    post_id: row.postId,
    post_title: row.postTitle,
    post_category: row.postCategory,
    post_author_name: row.postAuthorName,
    liked_at: toIso(row.likedAt) as string,
  }))
}

/**
 * 사용자가 좋아요한 게시글 **총 개수**. `listUserLikes`와 **같은 스코프**다 —
 * 삭제되지 않은 게시글(`posts.is_deleted = false`)만 센다.
 *
 * **단계 4 Task 6b에서 동작이 바뀌었다.** 그전까지 이 함수는 `posts`와 조인하지
 * 않고 `post_likes` 행을 전부 셌다(옛 Supabase 코드의
 * `.from('post_likes').select('id', {count:'exact', head:true})`를 그대로 옮긴
 * 결과다). 그래서 `/api/users/[id]/likes` 한 응답 안에서 목록(`liked_posts`,
 * 삭제 글 제외)과 총계(`pagination.total_count`, 삭제 글 포함)가 서로 다른
 * 기준을 말했다 — `total_pages`가 부풀어 마지막 페이지가 빈 채로 생긴다.
 *
 * **회원이 그 숫자를 본 적은 없다.** 이 엔드포인트를 부르는 화면·훅·E2E가
 * 저장소에 하나도 없고 클라이언트가 부른 이력도 없다. 즉 이 변경은 드러난
 * 오작동을 고친 것이 아니라, 한 응답 안의 두 숫자가 서로 다른 기준을 말하던
 * 상태를 소비자가 생기기 전에 정리한 것이다.
 *
 * 그 불일치는 설계가 아니라 사고다. 원본 Postgres `get_user_likes` RPC는
 * `p.is_deleted = false`로 조인했고, 총계만 그 RPC를 거치지 않는 **별개**
 * 쿼리였다. 두 쿼리가 같은 화면의 두 숫자를 만들면서 조건이 갈렸을 뿐,
 * "총계는 삭제 글도 세자"고 정한 곳은 어디에도 없다. 목록에 맞춘다.
 */
export async function countUserLikes(userId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(postLikes)
    .innerJoin(posts, eq(postLikes.postId, posts.id))
    .where(and(eq(postLikes.userId, userId), eq(posts.isDeleted, false)))
  return value
}
