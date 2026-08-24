/**
 * `posts` 쿼리 계층 (Turso/Drizzle). 읽기 전용 — 쓰기(작성/수정/삭제)는
 * Task 5(`게시글 쓰기 + 첨부 전환`)의 몫이다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정은 호출부(라우트)의
 * 몫이고, 이 모듈의 모든 함수는 이미 검증된 인자만 받는다.
 *
 * 응답 형태(`PostWithAuthor`)는 snake_case다 — `src/db/queries/profiles.ts`와
 * 같은 이유(CLAUDE.md, strict: false라 키가 바뀌면 화면이 조용히 빈다).
 *
 * `author` 임베드: 기존 PostgREST 쿼리는
 * `author:member_profiles!posts_author_id_fkey (display_name, ...)`처럼
 * `posts`와 `member_profiles`를 한 요청 안에서 조인해 `post.author.display_name`
 * 모양으로 돌려줬다. 이 모듈은 그 모양을 보존한다 — `author`는 항상
 * `{ id, display_name, email }` 객체다(널 아님). `posts.author_id`가
 * `member_profiles.id`를 참조하는 NOT NULL FK라 실제로는 항상 매칭되는 프로필이
 * 있어야 하지만, 혹시 배치 조회에서 프로필을 못 찾으면(예: 참조 무결성이 깨진
 * 레코드) `getPostAuthor`(옛 `src/lib/posts.ts`)의 기존 관례를 따라
 * `{ display_name: '알 수 없는 사용자' }`로 대체한다 — `null`을 돌려주면
 * `post.author.display_name`에서 그대로 죽는다.
 */

import { and, asc, desc, eq, gt, like, lt, or, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import { posts } from '../schema/index.ts'

import { getProfilesByIds } from './profiles.ts'
import { toIso } from './_helpers.ts'

/** API 응답에 쓰이는 snake_case 정규화 형태. `posts` 컬럼 전부 + author 임베드. */
export interface PostFields {
  id: string
  title: string
  content: string
  content_format: string
  category: string
  author_id: string
  created_at: string
  updated_at: string
  is_deleted: boolean
  is_pinned: boolean
  pinned_at: string | null
  like_count: number
  view_count: number
}

export interface PostAuthor {
  id: string
  display_name: string
  email: string
}

export type PostWithAuthor = PostFields & { author: PostAuthor }

type PostSelectRow = typeof posts.$inferSelect

function rowToPost(row: PostSelectRow): PostFields {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    content_format: row.contentFormat,
    category: row.category,
    author_id: row.authorId,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    is_deleted: row.isDeleted,
    is_pinned: row.isPinned,
    pinned_at: toIso(row.pinnedAt),
    like_count: row.likeCount,
    view_count: row.viewCount,
  }
}

const UNKNOWN_AUTHOR_DISPLAY_NAME = '알 수 없는 사용자'

/**
 * 게시글 행 배열에 저자를 **배치로** 붙인다 — 게시글마다 조회하지 않는다.
 * `ids`가 비면 `getProfilesByIds`가 쿼리 없이 즉시 빈 Map을 돌려주므로(Task 3
 * 계약), 빈 목록에 대해서도 실제 DB 왕복이 발생하지 않는다.
 */
async function attachAuthors(rows: PostFields[]): Promise<PostWithAuthor[]> {
  const authorIds = [...new Set(rows.map(row => row.author_id))]
  const profiles = await getProfilesByIds(authorIds)
  return rows.map(row => {
    const profile = profiles.get(row.author_id)
    const author: PostAuthor = profile
      ? { id: profile.id, display_name: profile.display_name, email: profile.email }
      : { id: row.author_id, display_name: UNKNOWN_AUTHOR_DISPLAY_NAME, email: '' }
    return { ...row, author }
  })
}

/**
 * id로 게시글 한 건을 조회한다.
 * @param opts.includeDeleted 기본 `false`(소프트 삭제된 글은 안 보인다).
 *   `true`면 삭제된 글도 반환한다 — 호출부가 작성자/관리자 권한을 이미 확인한
 *   뒤 "삭제된 글입니다" 같은 세분화된 응답을 만들 때 쓴다(예:
 *   `/api/posts/[id]` GET).
 * @returns 행이 없으면 `null`. 조회 자체가 실패하면(연결 오류 등) throw한다.
 */
export async function getPostById(
  id: string,
  opts?: { includeDeleted?: boolean }
): Promise<PostWithAuthor | null> {
  const includeDeleted = opts?.includeDeleted ?? false
  const conditions: SQL[] = [eq(posts.id, id)]
  if (!includeDeleted) {
    conditions.push(eq(posts.isDeleted, false))
  }
  const rows = await db
    .select()
    .from(posts)
    .where(and(...conditions))
    .limit(1)
  if (!rows[0]) return null
  const [withAuthor] = await attachAuthors([rowToPost(rows[0])])
  return withAuthor
}

export type PostSort = 'created_at_desc' | 'created_at_asc' | 'updated_at_desc'

export interface ListPostsFilter {
  /** 생략하거나 '전체'면 카테고리 필터 없음. */
  category?: string
  /** 1부터 시작. */
  page: number
  limit: number
  /** 기본 `false` — 소프트 삭제된 글은 목록에서 빠진다. */
  includeDeleted?: boolean
  /** 기본 `created_at_desc`. */
  sort?: PostSort
}

/**
 * 페이지 기반 게시글 목록. **게시글 1쿼리(총 개수는 윈도우 함수로 같은 쿼리에
 * 포함) + 저자 배치 1쿼리 = 총 2쿼리**로 끝낸다 — 게시글 수에 비례해 쿼리가
 * 늘지 않는다.
 *
 * @remarks `total`은 `count(*) over()` 윈도우 함수로 계산한다(별도 COUNT 쿼리를
 * 추가하지 않으려고). 이 페이지에 행이 하나도 없으면(예: `offset`이 실제 총
 * 개수를 넘어선 경우) 윈도우 함수 값도 함께 사라지므로 `total`은 `0`으로
 * 떨어진다 — 실제 총 개수가 0이 아니어도 그렇다. 이 모듈의 현재 호출부
 * (`generateStaticParams`·`sitemap.ts`)는 `total`을 읽지 않으므로 영향이
 * 없지만, 페이지네이션 UI가 `total`을 표시하는 새 호출부가 생기면 이 경계
 * 사례를 알고 있어야 한다.
 */
export async function listPosts(
  filter: ListPostsFilter
): Promise<{ rows: PostWithAuthor[]; total: number }> {
  const conditions: SQL[] = []
  if (!filter.includeDeleted) {
    conditions.push(eq(posts.isDeleted, false))
  }
  if (filter.category && filter.category !== '전체') {
    conditions.push(eq(posts.category, filter.category))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const sort = filter.sort ?? 'created_at_desc'
  const orderBy =
    sort === 'created_at_asc'
      ? asc(posts.createdAt)
      : sort === 'updated_at_desc'
        ? desc(posts.updatedAt)
        : desc(posts.createdAt)

  const offset = Math.max(0, (filter.page - 1) * filter.limit)

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      contentFormat: posts.contentFormat,
      category: posts.category,
      authorId: posts.authorId,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      isDeleted: posts.isDeleted,
      isPinned: posts.isPinned,
      pinnedAt: posts.pinnedAt,
      likeCount: posts.likeCount,
      viewCount: posts.viewCount,
      totalCount: sql<number>`count(*) over()`,
    })
    .from(posts)
    .where(where)
    .orderBy(orderBy)
    .limit(filter.limit)
    .offset(offset)

  const total = rows[0] ? Number(rows[0].totalCount) : 0
  const withAuthors = await attachAuthors(rows.map(rowToPost))
  return { rows: withAuthors, total }
}

export interface PostCursor {
  createdAt: string
  id: string
}

export interface ListPostsKeysetFilter {
  /** 생략하거나 '전체'면 카테고리 필터 없음. */
  category?: string
  /** 2글자 이상 토큰만 사용(최대 3개), title/content 부분일치 OR — 기존
   * `/api/posts/public`의 `escapePostgrestValue` + `.or()` 패턴과 동일 의미. */
  search?: string
  /** 없으면 첫 페이지 — 이때만 `is_pinned` 우선 정렬이 적용된다(기존 동작). */
  cursor?: PostCursor | null
  sortOrder: 'asc' | 'desc'
  limit: number
}

/**
 * 커서(keyset) 기반 게시글 목록 — `/api/posts/public`의 무한 스크롤 전용.
 * 정렬·커서 조건을 기존 PostgREST 쿼리와 그대로 옮긴다:
 * - 커서 없음(첫 페이지): `is_pinned DESC, created_at {dir}, id {dir}`
 * - 커서 있음: `is_pinned` 정렬을 적용하지 않고(기존 동작 그대로),
 *   `(created_at {>|<} cursor.createdAt) OR (created_at = cursor.createdAt AND id {>|<} cursor.id)`
 *
 * 게시글 1쿼리(`limit+1`로 다음 페이지 존재 여부 판단) + 저자 배치 1쿼리 = 총
 * 2쿼리.
 */
export async function listPostsKeyset(
  filter: ListPostsKeysetFilter
): Promise<{ rows: PostWithAuthor[]; hasNext: boolean }> {
  const conditions: SQL[] = [eq(posts.isDeleted, false)]
  if (filter.category && filter.category !== '전체') {
    conditions.push(eq(posts.category, filter.category))
  }
  if (filter.search) {
    const tokens = filter.search
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2)
      .slice(0, 3)
    if (tokens.length > 0) {
      const tokenConditions = tokens.flatMap(token => {
        const needle = `%${token}%`
        return [like(posts.title, needle), like(posts.content, needle)]
      })
      conditions.push(or(...tokenConditions) as SQL)
    }
  }

  const ascending = filter.sortOrder === 'asc'
  if (filter.cursor) {
    const cursorCreatedAt = new Date(filter.cursor.createdAt)
    const cursorCondition = ascending
      ? or(
          gt(posts.createdAt, cursorCreatedAt),
          and(eq(posts.createdAt, cursorCreatedAt), gt(posts.id, filter.cursor.id))
        )
      : or(
          lt(posts.createdAt, cursorCreatedAt),
          and(eq(posts.createdAt, cursorCreatedAt), lt(posts.id, filter.cursor.id))
        )
    conditions.push(cursorCondition as SQL)
  }

  const where = and(...conditions)

  const orderByClauses = filter.cursor ? [] : [desc(posts.isPinned)]
  orderByClauses.push(ascending ? asc(posts.createdAt) : desc(posts.createdAt))
  orderByClauses.push(ascending ? asc(posts.id) : desc(posts.id))

  const rows = await db
    .select()
    .from(posts)
    .where(where)
    .orderBy(...orderByClauses)
    .limit(filter.limit + 1)

  const hasNext = rows.length > filter.limit
  const sliced = hasNext ? rows.slice(0, filter.limit) : rows
  const withAuthors = await attachAuthors(sliced.map(rowToPost))
  return { rows: withAuthors, hasNext }
}
