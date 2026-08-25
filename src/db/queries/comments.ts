/**
 * `comments` 쿼리 계층 (Turso/Drizzle). Task 6(`댓글·좋아요 전환`)가 만든다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(작성자 본인·관리자
 * 확인)은 호출부(라우트)의 몫이고, 이 모듈의 모든 함수는 이미 검증된 인자만
 * 받는다.
 *
 * 응답 형태는 snake_case다 — `src/db/queries/posts.ts`·`attachments.ts`·
 * `profiles.ts`와 같은 이유(CLAUDE.md, `strict: false`라 키가 바뀌어도 화면이
 * 조용히 빈다).
 *
 * **저자 임베드:** 기존 PostgREST 쿼리는
 * `author:member_profiles!comments_author_id_fkey (display_name)`처럼 `comments`와
 * `member_profiles`를 한 요청 안에서 조인해 `comment.author.display_name` 모양으로
 * 돌려줬다. 이 모듈은 그 모양을 보존한다 — `author`는 항상 `{ display_name }`
 * 객체다(널 아님). `comments.author_id`가 `member_profiles.id`를 참조하는 NOT
 * NULL FK라 실제로는 항상 매칭되는 프로필이 있어야 하지만, 혹시 배치 조회에서
 * 프로필을 못 찾으면(예: 참조 무결성이 깨진 레코드) `src/db/queries/posts.ts`의
 * 관례를 따라 `{ display_name: '알 수 없는 사용자' }`로 대체한다 — `null`을
 * 돌려주면 `comment.author.display_name`에서 그대로 죽는다.
 *
 * **트리거 재현:** Postgres `update_comments_updated_at` 트리거는 SQLite에 없다 —
 * `comments.updatedAt`이 스키마 단(`src/db/schema/_shared.ts`의 `updatedAt()`)에서
 * `$onUpdate(() => new Date())`를 이미 갖고 있어(`posts`/`member_profiles`와 같은
 * 컬럼 팩토리), `.update()`를 쓰면 자동으로 현재 시각이 채워진다. 이 모듈에는
 * 현재 댓글을 부분 갱신하는 함수가 없다(원본 API에 댓글 수정 라우트가 없어
 * 옮길 대상이 없음) — `like_count` 갱신은 `src/db/queries/likes.ts`의
 * `toggleCommentLike`이 담당한다.
 */

import { and, asc, count, desc, eq, gt, gte, inArray, lte, or, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import { comments, posts } from '../schema/index.ts'

import { getProfilesByIds } from './profiles.ts'
import { toIso } from './_helpers.ts'

/** API 응답에 쓰이는 snake_case 정규화 형태. `comments` 컬럼 전부. */
export interface CommentRow {
  id: string
  post_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
  like_count: number
}

export interface CommentAuthor {
  display_name: string
}

export type CommentWithAuthor = CommentRow & { author: CommentAuthor }

type CommentSelectRow = typeof comments.$inferSelect

function rowToComment(row: CommentSelectRow): CommentRow {
  return {
    id: row.id,
    post_id: row.postId,
    author_id: row.authorId,
    content: row.content,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    like_count: row.likeCount,
  }
}

const UNKNOWN_AUTHOR_DISPLAY_NAME = '알 수 없는 사용자'

/**
 * 댓글 행 배열에 저자를 **배치로** 붙인다 — 댓글마다 조회하지 않는다.
 * `ids`가 비면 `getProfilesByIds`가 쿼리 없이 즉시 빈 Map을 돌려주므로(Task 3
 * 계약), 빈 목록에 대해서도 실제 DB 왕복이 발생하지 않는다.
 */
async function attachCommentAuthors(rows: CommentRow[]): Promise<CommentWithAuthor[]> {
  const authorIds = [...new Set(rows.map(row => row.author_id))]
  const profiles = await getProfilesByIds(authorIds)
  return rows.map(row => {
    const profile = profiles.get(row.author_id)
    const author: CommentAuthor = profile
      ? { display_name: profile.display_name }
      : { display_name: UNKNOWN_AUTHOR_DISPLAY_NAME }
    return { ...row, author }
  })
}

/**
 * id로 댓글 한 건을 조회한다. `postId`를 넘기면 그 게시글 소속인지도 함께
 * 확인한다(스코프 강제) — 삭제 라우트의 소유권 확인
 * (`comment.author_id !== user.id`)이 이 형태로 쓴다. `postId`를 생략하면
 * id만으로 조회한다 — 좋아요 라우트(`/api/comments/[id]/like`)처럼 URL에
 * postId가 없는 호출부가 쓴다(기존 `.select('id').eq('id', validCommentId)
 * .single()`과 동일 스코프). 저자 임베드 없이 원시 컬럼만 반환한다.
 */
export async function getCommentById(id: string, postId?: string): Promise<CommentRow | null> {
  const conditions: SQL[] = [eq(comments.id, id)]
  if (postId) {
    conditions.push(eq(comments.postId, postId))
  }
  const rows = await db
    .select()
    .from(comments)
    .where(and(...conditions))
    .limit(1)
  return rows[0] ? rowToComment(rows[0]) : null
}

export interface CreateCommentInput {
  post_id: string
  author_id: string
  content: string
}

/**
 * 댓글을 생성한다. `id`/`created_at`/`updated_at`/`like_count`는 DB 기본값에
 * 맡긴다. 저자 임베드 없이 `comments` 컬럼만 담아 반환한다 — 기존 Supabase
 * `.insert([...]).select('id, content, author_id, created_at').single()`도
 * 저자 조인을 하지 않았다.
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다).
 */
export async function createComment(input: CreateCommentInput): Promise<CommentRow> {
  const [row] = await db
    .insert(comments)
    .values({ postId: input.post_id, authorId: input.author_id, content: input.content })
    .returning()
  return rowToComment(row)
}

/** id + post_id로 댓글 한 건을 삭제한다(하드 삭제 — 기존 동작 그대로). 행이
 * 실제로 존재하는지는 호출부가 이미 `getCommentById`로 확인했다고 가정한다. */
export async function deleteComment(id: string, postId: string): Promise<void> {
  await db.delete(comments).where(and(eq(comments.id, id), eq(comments.postId, postId)))
}

export interface ListCommentsKeysetFilter {
  /** 커서 시작점. 생략/`null`이면 첫 페이지(게시글의 가장 오래된 댓글부터). */
  createdAt?: string | null
  /** `createdAt`과 함께 넘긴다 — 동률(created_at 동일) 타이브레이크. */
  id?: string | null
  limit: number
}

/**
 * 커서(keyset) 기반 댓글 목록 — `get_post_comments_keyset` RPC 대체.
 * **정렬·커서 조건을 원본 SQL과 그대로 옮긴다**:
 * `ORDER BY created_at ASC, id ASC`, 커서 조건은
 * `(created_at > p_created_at) OR (created_at = p_created_at AND id > p_id)`
 * (커서 없으면 전체 — `p_created_at IS NULL OR ...`와 동일 의미).
 *
 * 원본 RPC는 `select c.*`로 저자 임베드가 없었지만, 이 모듈은 `posts.ts`와
 * 같은 원칙으로 **항상** 저자를 배치로 붙인다 — 호출부(comments/route.ts,
 * comments-list/route.ts)가 기존에 일부 경로(RPC 성공 시)에서는 저자 없이,
 * 다른 경로(수동 폴백)에서는 저자를 붙여 돌려주던 비일관성을 없앤다(브리프:
 * "댓글의 저자 임베드도 PostgREST가 주던 모양 그대로여야 한다").
 */
export async function listCommentsKeyset(
  postId: string,
  filter: ListCommentsKeysetFilter
): Promise<CommentWithAuthor[]> {
  const conditions: SQL[] = [eq(comments.postId, postId)]
  if (filter.createdAt) {
    const cursorCreatedAt = new Date(filter.createdAt)
    const cursorCondition = filter.id
      ? or(
          gt(comments.createdAt, cursorCreatedAt),
          and(eq(comments.createdAt, cursorCreatedAt), gt(comments.id, filter.id))
        )
      : gt(comments.createdAt, cursorCreatedAt)
    conditions.push(cursorCondition as SQL)
  }

  const rows = await db
    .select()
    .from(comments)
    .where(and(...conditions))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(filter.limit)

  return attachCommentAuthors(rows.map(rowToComment))
}

export interface ListCommentsByOffsetFilter {
  limit: number
  offset: number
}

/**
 * 오프셋 기반 댓글 목록 — `/api/posts/[id]/route.ts`가 `limit`/`offset` 쿼리
 * 파라미터로 임의 페이지에 바로 접근할 때 쓴다(keyset은 이전 페이지의 커서가
 * 있어야 다음 페이지로 갈 수 있어 이 용례에 맞지 않는다). 정렬은
 * `created_at asc`(원본 Supabase `.order('created_at', {ascending:true})`와
 * 동일) + `id asc` 타이브레이크(원본엔 없던 결정론성 보강 — `created_at`이
 * 동률인 댓글 사이의 순서를 페이지 호출마다 안정적으로 고정한다,
 * `listPostsKeyset`이 이미 쓰는 것과 같은 패턴). 항상 저자를 배치로 붙인다.
 */
export async function listCommentsByOffset(
  postId: string,
  filter: ListCommentsByOffsetFilter
): Promise<CommentWithAuthor[]> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.postId, postId))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(filter.limit)
    .offset(filter.offset)

  return attachCommentAuthors(rows.map(rowToComment))
}

/** `post_id`로 댓글 총 개수를 센다 — 기존 Supabase `.select('id', {count:
 * 'exact', head: true})`와 같은 의미(행을 다 가져와 세지 않는다, 단일 집계
 * 쿼리). */
export async function countComments(postId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(comments)
    .where(eq(comments.postId, postId))
  return value
}

/**
 * 여러 게시글의 댓글 수를 **한 쿼리**(`GROUP BY post_id`)로 센다 — 게시판
 * 목록·관리자 게시글 목록에서 게시글마다 쿼리하지 않는다(N+1 방지). `postIds`가
 * 비면 쿼리 없이 즉시 빈 Map. 댓글이 0개인 게시글은 이 Map에 키 자체가 없다 —
 * 호출부가 `map.get(id) ?? 0`으로 기본값을 채운다(`board_posts_with_stats` 뷰가
 * `LEFT JOIN`으로 0을 주던 것과 동일한 최종 결과).
 */
export async function countCommentsByPostIds(postIds: string[]): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map()
  const rows = await db
    .select({ postId: comments.postId, value: count() })
    .from(comments)
    .where(inArray(comments.postId, postIds))
    .groupBy(comments.postId)
  return new Map(rows.map(row => [row.postId, row.value]))
}

export interface CommentWithPostSummary {
  id: string
  created_at: string
  /** 기존 PostgREST `posts:post_id (id, title, category)` 임베드와 같은 모양.
   * `comments.postId`가 `posts.id`를 참조하는 NOT NULL FK라 실제로는 항상
   * 매칭돼야 하지만, 배치 조회 관례(posts.ts/profiles.ts)를 따라 못 찾는
   * 경우를 `null`로 표현한다. */
  post: { id: string; title: string; category: string } | null
}

/**
 * `/api/mypage/activity`의 "내 댓글 활동"에 쓰는 조회(Task 8) — 댓글에 소속
 * 게시글의 `id`/`title`/`category`를 조인해 함께 담는다. 기존 Supabase
 * `.select('id, created_at, posts:post_id(id,title,category)')
 * .eq('author_id', userId).order('created_at', {ascending:false})
 * .limit(cap)`과 동일 조건 — `cap`은 호출부의 `SOURCE_ROW_CAP`을 그대로
 * 받는다. LEFT JOIN 1쿼리 — 댓글마다 게시글을 따로 조회하지 않는다.
 */
export async function listCommentsByAuthorWithPost(
  authorId: string,
  limit: number
): Promise<CommentWithPostSummary[]> {
  const rows = await db
    .select({
      id: comments.id,
      createdAt: comments.createdAt,
      postId: posts.id,
      postTitle: posts.title,
      postCategory: posts.category,
    })
    .from(comments)
    .leftJoin(posts, eq(comments.postId, posts.id))
    .where(eq(comments.authorId, authorId))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
  return rows.map(row => ({
    id: row.id,
    created_at: toIso(row.createdAt) as string,
    post: row.postId
      ? { id: row.postId, title: row.postTitle as string, category: row.postCategory as string }
      : null,
  }))
}

/**
 * `/api/admin/reports/generate`의 `generatePostEngagementReport`가 쓰는
 * 조회(Task 8) — 기간 내 댓글의 `id`/`post_id`/`created_at`만(게시글별 댓글
 * 수 집계는 호출부가 JS에서 한다, 원본 Supabase 쿼리와 동일 방식). 기존
 * `.gte('created_at',start).lte('created_at',end)`와 동일 조건.
 */
export async function listCommentsInRange(
  start: Date,
  end: Date
): Promise<{ id: string; post_id: string; created_at: string }[]> {
  const rows = await db
    .select({ id: comments.id, postId: comments.postId, createdAt: comments.createdAt })
    .from(comments)
    .where(and(gte(comments.createdAt, start), lte(comments.createdAt, end)))
  return rows.map(row => ({
    id: row.id,
    post_id: row.postId,
    created_at: toIso(row.createdAt) as string,
  }))
}
