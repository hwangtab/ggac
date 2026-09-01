/**
 * `posts` 쿼리 계층 (Turso/Drizzle). 읽기 + 쓰기(작성/수정/소프트삭제/조회수).
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정은 호출부(라우트)의
 * 몫이고, 이 모듈의 모든 함수는 이미 검증된 인자만 받는다.
 *
 * **트리거 재현(Task 5):** Postgres `update_posts_updated_at` 트리거는 SQLite에
 * 없다 — `posts.updatedAt`이 스키마 단(`src/db/schema/_shared.ts`의
 * `updatedAt()`)에서 `$onUpdate(() => new Date())`를 이미 갖고 있어(Task 3의
 * `member_profiles.updatedAt`과 같은 컬럼 팩토리), `updatePost`가 `.set()`을
 * 호출할 때마다 Drizzle이 자동으로 현재 시각을 채운다 — 이 모듈은 `updated_at`을
 * 직접 계산하지 않는다.
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

import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import { comments, posts } from '../schema/index.ts'

import { getProfilesByIds } from './profiles.ts'
import { countCommentsByPostIds } from './comments.ts'
import { getAttachmentStatsByPostIds } from './attachments.ts'
import { likeContains, toCamelCase, toIso } from './_helpers.ts'

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
        // `%`·`_`를 이스케이프하지 않으면 LIKE 와일드카드 인젝션이 된다 —
        // 예: 검색어 "%%"·"__"가 부분일치 대신 "아무 문자열"과 매치돼 검색
        // 없을 때와 동일한 전체 목록을 돌려준다(실측). likeContains가 이스케이프 +
        // ESCAPE 절을 함께 처리한다.
        return [likeContains(posts.title, token), likeContains(posts.content, token)]
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

// -------------------------------------------------------------------------
// board_posts_with_stats 뷰 대체 (Task 8)
// -------------------------------------------------------------------------

/** `board_posts_with_stats` 뷰(reference-views.md)와 같은 키 이름·같은 모양.
 * 소비 코드(`src/lib/server/board.ts`)가 이 키를 그대로 읽는다. */
export interface BoardPostStatsRow {
  id: string
  title: string
  category: string
  author_id: string
  created_at: string
  updated_at: string
  is_pinned: boolean
  content_head: string
  content_format: string
  like_count: number
  author_display_name: string | null
  comment_count: number
  total_attachments: number
  total_size: number
  image_count: number
  document_count: number
  video_count: number
  audio_count: number
}

export interface ListBoardPostsWithStatsFilter {
  /** 생략하거나 '전체'면 카테고리 필터 없음. */
  category?: string
  /** 0부터 시작. */
  offset: number
  limit: number
}

/**
 * `board_posts_with_stats` 뷰(reference-views.md) 대체. 원본 뷰가 한 SELECT로
 * 하던 조인·집계를, **게시글 1쿼리 + 저자 배치 1쿼리 + 댓글수 배치 1쿼리 +
 * 첨부통계 배치 1쿼리 = 총 4쿼리**로 옮긴다(게시글 수에 비례해 늘지 않는다).
 * Postgres `left(content, 2000)`는 SQLite `substr(content, 1, 2000)`으로
 * 옮긴다(reference-views.md). 정렬은 뷰 소비처(`src/lib/server/board.ts`)의
 * 기존 `.order('is_pinned', desc).order('created_at', desc).order('id', desc)`와
 * 동일하게 `is_pinned DESC, created_at DESC, id DESC`.
 *
 * `limit`개를 넘겨 요청하면 내부에서 `limit + 1`행을 가져와 `hasNext`를
 * 판정한다(호출부가 별도로 +1 페이지를 요청할 필요가 없다) — 기존
 * `fetchBoardPosts`가 Supabase `.range(start, end)`(end = start + limit,
 * inclusive라 사실상 limit+1행)로 하던 것과 같은 판정 방식.
 */
export async function listBoardPostsWithStats(
  filter: ListBoardPostsWithStatsFilter
): Promise<{ rows: BoardPostStatsRow[]; hasNext: boolean }> {
  const conditions: SQL[] = [eq(posts.isDeleted, false)]
  if (filter.category && filter.category !== '전체') {
    conditions.push(eq(posts.category, filter.category))
  }

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      category: posts.category,
      authorId: posts.authorId,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      isPinned: posts.isPinned,
      contentHead: sql<string>`substr(${posts.content}, 1, 2000)`,
      contentFormat: posts.contentFormat,
      likeCount: posts.likeCount,
    })
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(posts.isPinned), desc(posts.createdAt), desc(posts.id))
    .limit(filter.limit + 1)
    .offset(filter.offset)

  const hasNext = rows.length > filter.limit
  const sliced = hasNext ? rows.slice(0, filter.limit) : rows

  const postIds = sliced.map(row => row.id)
  const authorIds = [...new Set(sliced.map(row => row.authorId))]
  const [profiles, commentCounts, attachmentStats] = await Promise.all([
    getProfilesByIds(authorIds),
    countCommentsByPostIds(postIds),
    getAttachmentStatsByPostIds(postIds),
  ])

  const boardRows: BoardPostStatsRow[] = sliced.map(row => {
    const profile = profiles.get(row.authorId)
    const stats = attachmentStats.get(row.id)
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      author_id: row.authorId,
      created_at: toIso(row.createdAt) as string,
      updated_at: toIso(row.updatedAt) as string,
      is_pinned: row.isPinned,
      content_head: row.contentHead,
      content_format: row.contentFormat,
      like_count: row.likeCount,
      author_display_name: profile?.display_name ?? null,
      comment_count: commentCounts.get(row.id) ?? 0,
      total_attachments: stats?.total_attachments ?? 0,
      total_size: stats?.total_size ?? 0,
      image_count: stats?.image_count ?? 0,
      document_count: stats?.document_count ?? 0,
      video_count: stats?.video_count ?? 0,
      audio_count: stats?.audio_count ?? 0,
    }
  })

  return { rows: boardRows, hasNext }
}

// -------------------------------------------------------------------------
// 관리자 고급 검색 (Task 8) — 존재하지 않는 search_posts_advanced /
// count_posts_advanced RPC 대체
// -------------------------------------------------------------------------

export type AdvancedSearchSortField =
  | 'title'
  | 'category'
  | 'created_at'
  | 'updated_at'
  | 'comment_count'
export type AdvancedSearchSortDirection = 'asc' | 'desc'

export interface SearchPostsAdvancedFilter {
  /** `/api/admin/posts/advanced-search`가 이미 파싱해둔 단순 필터
   * (`category`/`is_pinned`/`is_deleted`의 `equals`만). */
  simpleFilters?: Record<string, unknown>
  /** title/content LIKE 검색어. 비었으면 검색 조건 없음. */
  searchText?: string
  /** 검색 대상 필드. `title`·`content`만 인식 — 그 외 값은 무시한다. */
  searchFields?: string[]
  sortField?: AdvancedSearchSortField
  sortDirection?: AdvancedSearchSortDirection
  page: number
  limit: number
}

/** 관리자 게시글 화면(`/admin/posts` "고급 검색")이 쓰는 응답 행 모양. 원본
 * 죽은 RPC(`search_posts_advanced`)가 존재하지 않아 실제 반환 모양을 확인할
 * 수 없었으므로, 이 저장소의 다른 게시글 목록 응답과 같은 관례
 * (`PostWithAuthor` + `comment_count`)로 정한다. */
export type AdvancedSearchPostRow = PostWithAuthor & { comment_count: number }

/**
 * `simpleFilters`의 boolean 필드(`is_pinned`/`is_deleted`) 값을 정규화한다.
 * 코드리뷰 지적(Important 1): `FilterCondition.value`는 `any`이고, UI의
 * boolean 필드 에디터(`src/components/filters/FilterConditionEditor.tsx`의
 * `<select><option value="true">예</option>...`)는 `e.target.value`를 그대로
 * 싣는다 — 즉 실제로 오는 값은 JS boolean이 아니라 문자열 `'true'`/`'false'`다.
 * `typeof value === 'boolean'`만 검사하면 이 문자열이 항상 걸러져 조건이
 * 조용히 사라진다(고정 여부를 골라도 전체가 나오는데 에러가 없다). 이
 * 라우트는 한 번도 동작한 적이 없어 "기존 동작 보존"을 주장할 수 없다 —
 * 이 커밋이 처음으로 계약을 정한다. `'true'`/`'false'` 문자열과 실제
 * boolean을 모두 받아들이고, 그 외(빈 문자열 `''`(select의 "선택하세요"
 * 기본값 포함)·`undefined`·다른 타입)는 "필터 미지정"으로 처리한다.
 */
function normalizeBooleanFilterValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function buildAdvancedSearchConditions(filter: SearchPostsAdvancedFilter): SQL[] {
  const conditions: SQL[] = []

  const simple = filter.simpleFilters ?? {}
  if (typeof simple.category === 'string' && simple.category) {
    conditions.push(eq(posts.category, simple.category))
  }
  const isPinnedFilter = normalizeBooleanFilterValue(simple.is_pinned)
  if (isPinnedFilter !== undefined) {
    conditions.push(eq(posts.isPinned, isPinnedFilter))
  }
  const isDeletedFilter = normalizeBooleanFilterValue(simple.is_deleted)
  if (isDeletedFilter !== undefined) {
    conditions.push(eq(posts.isDeleted, isDeletedFilter))
  } else {
    // 원본 필드 정의(POST_FIELD_DEFINITIONS)는 is_deleted를 필터 가능 필드로
    // 노출하지만, 관리자 화면이 명시적으로 고르지 않으면 삭제된 글까지
    // 뒤섞여 나오면 안 된다 — admin/posts(기본 목록) 라우트와 같은 기본값
    // (삭제되지 않은 글만).
    conditions.push(eq(posts.isDeleted, false))
  }

  const searchText = filter.searchText?.trim()
  if (searchText) {
    const fields = new Set(filter.searchFields ?? ['title', 'content'])
    const textConditions: SQL[] = []
    if (fields.has('title')) textConditions.push(likeContains(posts.title, searchText))
    if (fields.has('content')) textConditions.push(likeContains(posts.content, searchText))
    if (textConditions.length > 0) {
      conditions.push(or(...textConditions) as SQL)
    }
  }

  return conditions
}

/**
 * 관리자 게시글 "고급 검색"(`/api/admin/posts/advanced-search`)이 부르던
 * 없는 RPC `search_posts_advanced`의 대체. 전문검색(tsvector)이 아니라 `LIKE`
 * 기반이면 충분하다(원래 함수도 존재하지 않았고, 자매 함수
 * `execute_advanced_search`도 tsvector를 쓰지 않는다).
 *
 * **`comment_count` 정렬(코드리뷰 Important 2 수정):** 처음에는 "DB에서
 * 정렬할 수 없다"고 판단해 페이지 안 20행만 JS로 재정렬했는데, 이건
 * **페이지 국소적** 정렬이라 전역 정렬이 아니었다(2페이지에 1페이지보다
 * 댓글이 많은 글이 나오는 등, 게시글 수가 `limit`을 넘는 순간부터 항상
 * 틀렸다). SQLite는 상관 서브쿼리를 `ORDER BY`에 직접 쓸 수 있어
 * `(select count(*) from comments where comments.post_id = posts.id)`를
 * `sql` 템플릿으로 만들어 `orderBy`에 넘긴다 — DB가 전체 행을 대상으로
 * 정렬한 뒤 `LIMIT`/`OFFSET`을 적용하므로 페이지 경계가 없다. 응답에 실을
 * `comment_count` 값 자체는 여전히 `countCommentsByPostIds` 배치 조회로
 * 채운다(이 서브쿼리는 정렬에만 쓰고, 값 조회에는 기존 배치 경로를 그대로
 * 쓴다 — 중복 계산이지만 이 페이지 크기(최대 100)에서는 무시할 만하다).
 *
 * @remarks `total`은 `count(*) over()` 윈도우 함수로 계산한다 — `listPosts`와
 * 같은 경계 조건이다: `offset >= total`이면 이 페이지에 행이 0개라 `total`도
 * 0으로 떨어진다(실제 총 개수가 0이 아니어도). 관리자 게시글 목록처럼
 * 페이지네이션 UI가 `total`을 표시하는 호출부는 이 경계를 반드시 고려해야
 * 한다 — 이 함수의 호출부(advanced-search 라우트)는 마지막 페이지 초과 접근을
 * 별도 count 쿼리로 보정한다(라우트 코드 참고).
 */
export async function searchPostsAdvanced(
  filter: SearchPostsAdvancedFilter
): Promise<{ rows: AdvancedSearchPostRow[]; total: number }> {
  const conditions = buildAdvancedSearchConditions(filter)
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const sortField = filter.sortField ?? 'created_at'
  const sortDirection = filter.sortDirection ?? 'desc'

  let orderBy: SQL
  if (sortField === 'comment_count') {
    const commentCountExpr = sql`(select count(*) from ${comments} where ${comments.postId} = ${posts.id})`
    orderBy = sortDirection === 'asc' ? asc(commentCountExpr) : desc(commentCountExpr)
  } else {
    const dbSortColumn =
      sortField === 'title'
        ? posts.title
        : sortField === 'category'
          ? posts.category
          : sortField === 'updated_at'
            ? posts.updatedAt
            : posts.createdAt
    orderBy = sortDirection === 'asc' ? asc(dbSortColumn) : desc(dbSortColumn)
  }

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
  const postIds = rows.map(row => row.id)
  const [withAuthors, commentCounts] = await Promise.all([
    attachAuthors(rows.map(rowToPost)),
    countCommentsByPostIds(postIds),
  ])

  // DB가 이미 정렬 순서대로 rows를 돌려줬으므로(comment_count 정렬 포함),
  // withAuthors의 순서를 그대로 보존한다 — JS 재정렬은 하지 않는다.
  const result: AdvancedSearchPostRow[] = withAuthors.map(row => ({
    ...row,
    comment_count: commentCounts.get(row.id) ?? 0,
  }))

  return { rows: result, total }
}

/**
 * `searchPostsAdvanced`와 같은 필터 조건으로 총 개수만 센다(행은 가져오지
 * 않는다) — 관리자 "고급 검색" 페이지네이션 UI가 마지막 페이지를 넘어간
 * 요청에서도 정확한 총 개수를 보여줘야 할 때 쓴다(`listPosts.total`의
 * `count(*) over()` 경계 조건 우회 — 위 함수 설명 참고).
 */
export async function countPostsAdvanced(
  filter: Pick<SearchPostsAdvancedFilter, 'simpleFilters' | 'searchText' | 'searchFields'>
): Promise<number> {
  const conditions = buildAdvancedSearchConditions(filter as SearchPostsAdvancedFilter)
  const where = conditions.length > 0 ? and(...conditions) : undefined
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(posts)
    .where(where)
  return Number(value)
}

// -------------------------------------------------------------------------
// 관리자 게시글 기본 목록 (Task 8) — `/api/admin/posts` GET 대체
// -------------------------------------------------------------------------

export type AdminPostListFilter = 'all' | 'deleted' | 'pinned' | string

export interface ListPostsForAdminFilter {
  /** 'all'|'deleted'|'pinned'|카테고리명. 기존 라우트와 동일한 의미 —
   * 'deleted'만 `is_deleted=true`로 좁히고, 'all'·'pinned'·카테고리는
   * `is_deleted`를 전혀 필터링하지 않는다(삭제된 글도 섞여 나온다 — 관리자
   * 화면의 기존 동작을 그대로 보존한다. `searchPostsAdvanced`의 "기본은
   * 비삭제만"과는 의도적으로 다르다). */
  filter: AdminPostListFilter
  /** title/content LIKE 검색어. 호출부(`admin/posts/route.ts`)가 이미
   * `validateSearchQuery`로 검증·새니타이즈한 `sanitized` 값을 넘긴다 — 이
   * 함수 자체는 새니타이징하지 않는다. `likeContains`(`_helpers.ts`)가
   * Drizzle 파라미터 바인딩 + `%`/`_` 이스케이프를 함께 처리하므로 SQL
   * 인젝션도, LIKE 와일드카드 인젝션(검색어 자체에 `%`/`_`가 섞여 검색이
   * 무력화되는 문제)도 없다(옛 PostgREST `escapePostgrestValue`는 Supabase
   * `.or()` 문자열 조합용이었고, 이 커밋에서 그 호출 자체가 사라졌다). */
  search?: string
  page: number
  limit: number
}

/**
 * `/api/admin/posts` GET이 쓰던 Supabase 쿼리(필터+검색+페이지네이션+댓글수
 * N+1 아님 배치)를 그대로 옮긴다. **정확한 총 개수가 필요하므로**(관리자
 * 페이지네이션 UI가 `total`을 표시 — task-8-brief의 "listPosts.total 경계"
 * 경고 대상) `count(*) over()` 대신 별도 COUNT 쿼리를 쓴다. 게시글 1쿼리 +
 * COUNT 1쿼리 + 저자 배치 1쿼리 + 댓글수 배치 1쿼리 = 총 4쿼리.
 */
export async function listPostsForAdmin(
  filter: ListPostsForAdminFilter
): Promise<{ rows: AdvancedSearchPostRow[]; total: number }> {
  const conditions: SQL[] = []
  if (filter.filter === 'deleted') {
    conditions.push(eq(posts.isDeleted, true))
  } else if (filter.filter === 'pinned') {
    conditions.push(eq(posts.isPinned, true))
  } else if (filter.filter !== 'all') {
    conditions.push(eq(posts.category, filter.filter))
  }

  const search = filter.search?.trim()
  if (search) {
    conditions.push(
      or(likeContains(posts.title, search), likeContains(posts.content, search)) as SQL
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = Math.max(0, (filter.page - 1) * filter.limit)

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt))
      .limit(filter.limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)` })
      .from(posts)
      .where(where),
  ])

  const postIds = rows.map(row => row.id)
  const [withAuthors, commentCounts] = await Promise.all([
    attachAuthors(rows.map(rowToPost)),
    countCommentsByPostIds(postIds),
  ])

  const result: AdvancedSearchPostRow[] = withAuthors.map(row => ({
    ...row,
    comment_count: commentCounts.get(row.id) ?? 0,
  }))

  return { rows: result, total: Number(total) }
}

export interface AdminPostStats {
  totalPosts: number
  totalDeleted: number
  totalPinned: number
  categoryStats: Record<string, number>
}

/**
 * `/api/admin/posts/stats` GET이 쓰던 4개 Supabase count 쿼리(전체/삭제/고정/
 * 카테고리별)를 옮긴다. 카테고리별 집계는 원본이 `is_deleted=false`인 행
 * 전체를 내려받아 JS에서 세던 것을, `GROUP BY category` 단일 쿼리로 바꾼다
 * (전수감사 지적 없이도 이 라운드에서 자연히 N+1을 줄인 것 — 원래도 N+1은
 * 아니었지만 전행 다운로드였다). 총 4쿼리(개수는 늘지 않는다, 병렬 실행).
 */
export async function getAdminPostStats(): Promise<AdminPostStats> {
  const [totalRow, deletedRow, pinnedRow, categoryRows] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(posts),
    db
      .select({ value: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.isDeleted, true)),
    db
      .select({ value: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.isPinned, true)),
    db
      .select({ category: posts.category, value: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.isDeleted, false))
      .groupBy(posts.category),
  ])

  const categoryStats: Record<string, number> = { 공지: 0, 잡담: 0, 홍보: 0, 건의: 0 }
  for (const row of categoryRows) {
    if (row.category in categoryStats) {
      categoryStats[row.category] = Number(row.value)
    }
  }

  return {
    totalPosts: Number(totalRow[0]?.value ?? 0),
    totalDeleted: Number(deletedRow[0]?.value ?? 0),
    totalPinned: Number(pinnedRow[0]?.value ?? 0),
    categoryStats,
  }
}

/**
 * `/api/admin/activity`가 "최근 게시글 활동"에 쓰는 조회를 옮긴다. 기존
 * Supabase `.gte('created_at', cutoffDate).eq('is_deleted', false)
 * .order('created_at', {ascending:false}).limit(n)`과 동일 조건.
 */
export async function listRecentPostsForActivity(
  since: Date,
  limit: number
): Promise<PostWithAuthor[]> {
  const rows = await db
    .select()
    .from(posts)
    .where(and(gte(posts.createdAt, since), eq(posts.isDeleted, false)))
    .orderBy(desc(posts.createdAt))
    .limit(limit)
  return attachAuthors(rows.map(rowToPost))
}

/**
 * `/api/admin/stats/monthly`의 월별 게시글 집계에 쓰는 가벼운 조회(Task 8) —
 * `created_at`만 담아 반환한다(월별로 JS에서 버케팅하므로 전체 컬럼이
 * 필요 없다). 기존 Supabase `.gte('created_at', startDate).eq('is_deleted',
 * false).order('created_at', {ascending:true})`와 동일 조건. `limit` 없음 —
 * 집계 대상 기간(최대 24개월) 전체가 필요하다.
 */
export async function listPostCreationsSince(since: Date): Promise<{ created_at: string }[]> {
  const rows = await db
    .select({ createdAt: posts.createdAt })
    .from(posts)
    .where(and(gte(posts.createdAt, since), eq(posts.isDeleted, false)))
    .orderBy(asc(posts.createdAt))
  return rows.map(row => ({ created_at: toIso(row.createdAt) as string }))
}

/** `/api/admin/stats` 대시보드의 "전체 게시글 수(삭제 제외)" count. */
export async function countActivePosts(): Promise<number> {
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(posts)
    .where(eq(posts.isDeleted, false))
  return Number(value)
}

export interface PostActivitySummary {
  id: string
  title: string
  category: string
  created_at: string
  updated_at: string
}

/**
 * `/api/mypage/activity`의 "내 게시글 활동"에 쓰는 조회(Task 8). 기존
 * Supabase `.eq('author_id', userId).eq('is_deleted', false)
 * .order('created_at', {ascending:false}).limit(cap)`과 동일 조건 — `cap`은
 * 호출부의 `SOURCE_ROW_CAP`(폭주 방지, 전수감사 API Medium 12)을 그대로
 * 받는다.
 */
export async function listPostsByAuthor(
  authorId: string,
  limit: number
): Promise<PostActivitySummary[]> {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      category: posts.category,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(and(eq(posts.authorId, authorId), eq(posts.isDeleted, false)))
    .orderBy(desc(posts.createdAt))
    .limit(limit)
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    category: row.category,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
  }))
}

export interface PostEngagementReportRow {
  id: string
  title: string
  category: string
  created_at: string
  like_count: number
  view_count: number
  is_pinned: boolean
  author_id: string
}

/**
 * `/api/admin/reports/generate`의 `generatePostEngagementReport`가 쓰는
 * 조회(Task 8). 기존 Supabase `.gte('created_at',start).lte('created_at',end)
 * .order('created_at', {ascending:false})`와 동일 조건 — `is_deleted` 필터가
 * 원본에 없었으므로(리포트는 삭제된 글도 포함) 이 함수도 걸지 않는다.
 */
export async function listPostsInRange(start: Date, end: Date): Promise<PostEngagementReportRow[]> {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      category: posts.category,
      createdAt: posts.createdAt,
      likeCount: posts.likeCount,
      viewCount: posts.viewCount,
      isPinned: posts.isPinned,
      authorId: posts.authorId,
    })
    .from(posts)
    .where(and(gte(posts.createdAt, start), lte(posts.createdAt, end)))
    .orderBy(desc(posts.createdAt))
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    category: row.category,
    created_at: toIso(row.createdAt) as string,
    like_count: row.likeCount,
    view_count: row.viewCount,
    is_pinned: row.isPinned,
    author_id: row.authorId,
  }))
}

// -------------------------------------------------------------------------
// 쓰기 (Task 5)
// -------------------------------------------------------------------------

/** timestamp_ms 컬럼 중 ISO 문자열로 주고받는 것(snake_case 키 기준). */
const POST_TIMESTAMP_FIELDS = new Set(['pinned_at', 'created_at', 'updated_at'])

/**
 * snake_case 쓰기 입력 → Drizzle `.values()`/`.set()`용 camelCase 객체.
 * `src/db/queries/profiles.ts`의 `toWriteRow`와 같은 패턴.
 */
function toWriteRow(row: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (POST_TIMESTAMP_FIELDS.has(key) && typeof value === 'string') {
      converted[key] = new Date(value)
    } else {
      converted[key] = value
    }
  }
  return toCamelCase(converted)
}

export interface CreatePostInput {
  title: string
  content: string
  content_format: string
  category: string
  author_id: string
  /** 기본 `false`. */
  is_pinned?: boolean
  /** ISO 문자열 또는 `null`. 생략하면 `null`. */
  pinned_at?: string | null
}

/**
 * 게시글을 생성한다. `id`/`created_at`/`updated_at`/`like_count`/`view_count`는
 * DB 기본값에 맡긴다(`src/db/schema/content.ts`의 `posts` 정의). 반환값은
 * `author` 임베드 없이 `posts` 컬럼만 담는다 — 기존 Supabase
 * `.insert(...).select().single()`도 저자 조인을 하지 않았고, 유일한 호출부
 * (`usePostCreation.ts`)는 `post.id`만 읽는다.
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다).
 */
export async function createPost(input: CreatePostInput): Promise<PostFields> {
  const values = toWriteRow({
    title: input.title,
    content: input.content,
    content_format: input.content_format,
    category: input.category,
    author_id: input.author_id,
    is_pinned: input.is_pinned ?? false,
    pinned_at: input.pinned_at ?? null,
  }) as typeof posts.$inferInsert
  const [row] = await db.insert(posts).values(values).returning()
  return rowToPost(row)
}

export type PostPatch = Partial<{
  title: string
  content: string
  content_format: string
  category: string
  is_pinned: boolean
  /** ISO 문자열 또는 `null`. */
  pinned_at: string | null
  /** 관리자 게시글 복원/삭제 액션(`/api/admin/posts/[id]` PATCH, Task 8)이
   * `softDeletePost`(삭제 전용)와 달리 삭제/복원을 한 함수로 다루고 싶을 때
   * 쓴다 — `softDeletePost`는 여전히 일반 삭제 라우트가 쓰는 전용 함수로
   * 남아 있다. */
  is_deleted: boolean
}>

/**
 * 게시글 일부 컬럼을 갱신한다(제목/본문/카테고리/고정 여부). `updated_at`은
 * patch에 넣어도 무시한다 — 스키마의 `$onUpdate` 훅이 `.set()` 호출마다
 * 자동으로 채운다(Postgres `update_posts_updated_at` 트리거의 대체, 위 모듈
 * 설명 참고). patch가 빈 객체면 쿼리를 실행하지 않고 현재 행을 그대로
 * 돌려준다(갱신할 것이 없다 — `updateProfile`과 달리 여기서는 `null`이 아니라
 * 호출부가 항상 갱신 결과를 응답에 그대로 실어야 해서 조회까지 해서 돌려준다).
 * @returns 행이 없으면 `null`. 조회/쓰기 자체가 실패하면 throw한다.
 */
export async function updatePost(id: string, patch: PostPatch): Promise<PostFields | null> {
  const values = toWriteRow(patch as Record<string, unknown>)
  if (Object.keys(values).length === 0) {
    const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
    return rows[0] ? rowToPost(rows[0]) : null
  }
  const rows = await db
    .update(posts)
    .set(values as Partial<typeof posts.$inferInsert>)
    .where(eq(posts.id, id))
    .returning()
  return rows[0] ? rowToPost(rows[0]) : null
}

/**
 * 게시글을 소프트 삭제한다(`is_deleted = true`). 하드 삭제가 아니다 — 기존
 * `/api/posts/[id]` DELETE의 `.update({ is_deleted: true })`와 동일한 방식을
 * 그대로 옮긴 것이다. 행이 실제로 존재하는지는 호출부가 이미
 * `getPostById`로 확인했다고 가정한다(기존 라우트 동작과 동일 — 이 함수
 * 자체는 영향받은 행 수를 확인하지 않는다).
 */
export async function softDeletePost(id: string): Promise<void> {
  await db.update(posts).set({ isDeleted: true }).where(eq(posts.id, id))
}

/**
 * 조회수를 1 증가시킨다. **`UPDATE posts SET view_count = view_count + 1
 * WHERE id = ? ` 한 문장**으로 끝낸다 — 읽고(view_count 조회) 더해서
 * 쓰는(별도 UPDATE) 왕복을 만들지 않는다. 동시 조회 요청 사이에서 증가분이
 * 유실되지 않는 이유가 바로 이 원자적 UPDATE다(`view_count = view_count + 1`은
 * SQLite가 행 단위로 직렬화해 실행한다).
 * @returns 갱신 후 view_count. 행이 없으면 `null`.
 */
export async function incrementViewCount(id: string): Promise<number | null> {
  const rows = await db
    .update(posts)
    .set({ viewCount: sql`${posts.viewCount} + 1` })
    .where(eq(posts.id, id))
    .returning({ viewCount: posts.viewCount })
  return rows[0] ? rows[0].viewCount : null
}
