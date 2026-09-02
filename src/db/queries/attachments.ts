/**
 * `post_attachments` 쿼리 계층 (Turso/Drizzle). Task 5(`게시글 쓰기 + 첨부
 * 전환`)가 만든다.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(작성자 본인·관리자
 * 확인)은 호출부(라우트)의 몫이고, 이 모듈의 모든 함수는 이미 검증된 인자만
 * 받는다.
 *
 * 응답 형태는 snake_case다 — `src/db/queries/posts.ts`·`profiles.ts`와 같은
 * 이유(CLAUDE.md, `strict: false`라 키가 바뀌어도 화면이 조용히 빈다).
 *
 * **첨부 파일 자체(Vercel Blob의 바이너리)는 이 모듈이 다루지 않는다** — `posts`
 * 쓰기 전환 브리프가 명시한 대로, 여기서는 `post_attachments` **행**만
 * 다룬다. Storage 업로드/삭제(`@/lib/storage/provider`)는 호출부(라우트)가
 * 그대로 담당한다.
 *
 * **트리거 재현:** Postgres `trigger_update_attachment_sort_order`는 INSERT 시
 * `sort_order`가 `NULL`이거나 `0`이면 같은 `post_id` 안의 `MAX(sort_order) + 1`을
 * 채운다. SQLite에는 이 트리거가 없으므로 `addAttachment`가 코드로 재현한다 —
 * `MAX(sort_order)` 조회와 `INSERT`를 **하나의 트랜잭션**(`db.transaction`) 안에서
 * 실행해, 동시 업로드 두 건이 같은 번호를 받는 경합을 막는다. 명시적으로
 * 넘긴 `sort_order`(0이나 falsy가 아닌 값)는 그대로 존중한다.
 */

import { and, asc, desc, eq, inArray, lt, ne, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import { postAttachments, posts } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

/** API 응답에 쓰이는 snake_case 정규화 형태. `post_attachments` 컬럼 전부. */
export interface PostAttachmentRow {
  id: string
  post_id: string
  file_name: string
  file_url: string
  file_type: string
  file_size: number
  mime_type: string
  alt_text: string | null
  is_primary: boolean
  sort_order: number
  created_at: string
  updated_at: string
  is_temporary: boolean
  temp_session: string | null
  expires_at: string | null
}

type AttachmentSelectRow = typeof postAttachments.$inferSelect

function rowToAttachment(row: AttachmentSelectRow): PostAttachmentRow {
  return {
    id: row.id,
    post_id: row.postId,
    file_name: row.fileName,
    file_url: row.fileUrl,
    file_type: row.fileType,
    file_size: row.fileSize,
    mime_type: row.mimeType,
    alt_text: row.altText,
    is_primary: row.isPrimary,
    sort_order: row.sortOrder,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    is_temporary: row.isTemporary,
    temp_session: row.tempSession,
    expires_at: toIso(row.expiresAt),
  }
}

export interface AddAttachmentInput {
  post_id: string
  file_name: string
  file_url: string
  file_type: string
  file_size: number
  mime_type: string
  alt_text?: string | null
  /** 기본 `false`. */
  is_primary?: boolean
  /** 생략하거나 `null`/`0`이면 같은 `post_id` 안의 `MAX(sort_order) + 1`을
   * 자동 부여한다(트리거 재현 — 위 모듈 설명 참고). 그 외 값은 그대로
   * 존중한다. */
  sort_order?: number | null
  /** 기본 `false`. */
  is_temporary?: boolean
  temp_session?: string | null
  /** ISO 문자열 또는 `null`. */
  expires_at?: string | null
}

/**
 * 첨부파일 한 건을 추가한다. `sort_order`를 생략하거나 `0`/`null`로 넘기면
 * `MAX(sort_order) + 1`을 자동 부여한다 — 그 조회와 INSERT를 **하나의
 * 트랜잭션** 안에서 실행해 동시 업로드가 같은 번호를 받지 않게 한다.
 * @throws DB 쓰기가 실패하면 그대로 던진다.
 */
export async function addAttachment(input: AddAttachmentInput): Promise<PostAttachmentRow> {
  const row = await db.transaction(async tx => {
    // 대표 이미지로 넣는다면 같은 트랜잭션 안에서 기존 대표를 먼저 내린다.
    // 라우트가 unsetPrimaryForPost를 따로 부르던 시절에는 두 문 사이가
    // 벌어져 동시 업로드 두 건이 모두 대표가 될 수 있었다.
    if (input.is_primary) {
      await tx
        .update(postAttachments)
        .set({ isPrimary: false })
        .where(and(eq(postAttachments.postId, input.post_id), eq(postAttachments.isPrimary, true)))
    }
    let sortOrder = input.sort_order
    if (!sortOrder) {
      const [maxRow] = await tx
        .select({ maxSortOrder: sql<number | null>`max(${postAttachments.sortOrder})` })
        .from(postAttachments)
        .where(eq(postAttachments.postId, input.post_id))
      sortOrder = (maxRow?.maxSortOrder ?? 0) + 1
    }
    const [inserted] = await tx
      .insert(postAttachments)
      .values({
        postId: input.post_id,
        fileName: input.file_name,
        fileUrl: input.file_url,
        fileType: input.file_type,
        fileSize: input.file_size,
        mimeType: input.mime_type,
        altText: input.alt_text ?? null,
        isPrimary: input.is_primary ?? false,
        sortOrder,
        isTemporary: input.is_temporary ?? false,
        tempSession: input.temp_session ?? null,
        expiresAt: input.expires_at ? new Date(input.expires_at) : null,
      })
      .returning()
    return inserted
  })
  return rowToAttachment(row)
}

/**
 * `post_id`로 첨부파일 목록을 조회한다. 기본 정렬은 `sort_order` 오름차순
 * (업로드/수정 API의 기존 동작). `opts.orderBy: 'created_at'`을 넘기면
 * `created_at` 오름차순으로 정렬한다 — 단계 2c(Task 6 후속): 게시글 상세
 * 표시 경로(`board/post/[id]/route.ts`, `board/[id]/page.tsx`)가 옛
 * Supabase 쿼리에서 `.order('created_at', {ascending:true})`를 썼던 것을
 * 그대로 재현하기 위함이다.
 */
export async function listAttachments(
  postId: string,
  opts?: { orderBy?: 'sort_order' | 'created_at' }
): Promise<PostAttachmentRow[]> {
  const orderBy = opts?.orderBy ?? 'sort_order'
  const rows = await db
    .select()
    .from(postAttachments)
    .where(eq(postAttachments.postId, postId))
    .orderBy(
      orderBy === 'created_at' ? asc(postAttachments.createdAt) : asc(postAttachments.sortOrder)
    )
  return rows.map(rowToAttachment)
}

/**
 * 여러 게시글의 첨부파일을 **한 쿼리**(`inArray`)로 조회한다 — 게시글
 * 목록에서 첨부 통계를 낼 때 게시글마다 쿼리하지 않는다(N+1 방지).
 * `postIds`가 비면 쿼리 없이 즉시 빈 배열. 정렬 보장 없음(호출부가 JS에서
 * `post_id`별로 그룹핑해 쓴다 — `src/app/api/posts/public/route.ts`).
 */
export async function listAttachmentsByPostIds(postIds: string[]): Promise<PostAttachmentRow[]> {
  if (postIds.length === 0) return []
  const rows = await db
    .select()
    .from(postAttachments)
    .where(inArray(postAttachments.postId, postIds))
  return rows.map(rowToAttachment)
}

/**
 * 게시글의 이미지 첨부만 `is_primary` 우선, 그다음 `created_at` 오름차순으로
 * 조회한다 — 대표 이미지(OG 이미지, 썸네일)를 고를 때 쓴다
 * (`src/app/api/og/post/[id]/route.tsx`, `src/lib/posts.ts`의
 * `getPostImages`/`getPostThumbnail`). 첫 번째 원소가 곧 "표시용 대표
 * 이미지"다.
 */
export async function listImageAttachments(postId: string): Promise<PostAttachmentRow[]> {
  const rows = await db
    .select()
    .from(postAttachments)
    .where(and(eq(postAttachments.postId, postId), eq(postAttachments.fileType, 'image')))
    .orderBy(desc(postAttachments.isPrimary), asc(postAttachments.createdAt))
  return rows.map(rowToAttachment)
}

/**
 * `listImageAttachments`와 같은 순서에서 **첫 한 건만** 가져온다 — 대표
 * 이미지 하나만 쓰는 호출부(OG 이미지 라우트)를 위한 `LIMIT 1` 판이다.
 *
 * 이관 과정에서 원본 Supabase 쿼리의 `.limit(1)`이 빠져, 첨부가 여러 장인
 * 게시글의 OG 이미지 요청이 매번 첨부 전부를 실어 오고 `[0]`만 쓰고 버렸다.
 * OG 라우트는 크롤러·메신저 미리보기가 부르는 뜨거운 경로라 그 낭비가
 * 그대로 남는다.
 *
 * @returns 이미지 첨부가 없으면 `null`.
 */
export async function getPrimaryImageAttachment(postId: string): Promise<PostAttachmentRow | null> {
  const rows = await db
    .select()
    .from(postAttachments)
    .where(and(eq(postAttachments.postId, postId), eq(postAttachments.fileType, 'image')))
    .orderBy(desc(postAttachments.isPrimary), asc(postAttachments.createdAt))
    .limit(1)
  return rows[0] ? rowToAttachment(rows[0]) : null
}

/** id + post_id로 첨부파일 한 건을 조회한다(소유 게시글 스코프 강제). */
export async function getAttachmentById(
  id: string,
  postId: string
): Promise<PostAttachmentRow | null> {
  const rows = await db
    .select()
    .from(postAttachments)
    .where(and(eq(postAttachments.id, id), eq(postAttachments.postId, postId)))
    .limit(1)
  return rows[0] ? rowToAttachment(rows[0]) : null
}

export interface AttachmentWithPost extends PostAttachmentRow {
  /** 기존 PostgREST `post_attachments!*(author_id, category)` 임베드와 같은
   * 모양 — 라우트의 권한 판정(`attachment.posts.author_id !== user.id`)이
   * 그대로 쓸 수 있게 유지한다. */
  posts: { author_id: string; category: string } | null
}

/**
 * id + post_id로 첨부파일 한 건을 조회하되, 소속 게시글의 `author_id`/
 * `category`도 함께 담아 돌려준다 — 첨부파일 수정/삭제 라우트가 게시글
 * 작성자 권한을 판정할 때 쓴다(호출부가 판정, 이 함수는 데이터만 조인).
 */
export async function getAttachmentWithPost(
  id: string,
  postId: string
): Promise<AttachmentWithPost | null> {
  const rows = await db
    .select({
      attachment: postAttachments,
      authorId: posts.authorId,
      category: posts.category,
    })
    .from(postAttachments)
    .innerJoin(posts, eq(postAttachments.postId, posts.id))
    .where(and(eq(postAttachments.id, id), eq(postAttachments.postId, postId)))
    .limit(1)
  if (!rows[0]) return null
  return {
    ...rowToAttachment(rows[0].attachment),
    posts: { author_id: rows[0].authorId, category: rows[0].category },
  }
}

export interface PostAttachmentStatsRow {
  total_attachments: number
  total_size: number
  image_count: number
  document_count: number
  video_count: number
  audio_count: number
}

/**
 * 여러 게시글의 첨부파일 집계(`board_posts_with_stats` 뷰의 LATERAL 서브쿼리
 * 대체, Task 8)를 **한 쿼리**(`GROUP BY post_id`)로 낸다 — 게시글마다 조회하지
 * 않는다(N+1 방지). Postgres 뷰의 `a.is_temporary IS NOT TRUE` 조건은 SQLite로
 * 옮기면 `isTemporary = false`와 같다(컬럼이 `NOT NULL DEFAULT false`라 NULL이
 * 존재할 수 없다 — reference-views.md의 `IS NOT TRUE` 주의사항은 nullable 컬럼
 * 얘기이고, 이 컬럼은 아니다). `postIds`가 비면 쿼리 없이 즉시 빈 Map. 첨부가
 * 없는(또는 전부 임시인) 게시글은 이 Map에 키가 없다 — 호출부가 0으로 채운다.
 */
export async function getAttachmentStatsByPostIds(
  postIds: string[]
): Promise<Map<string, PostAttachmentStatsRow>> {
  if (postIds.length === 0) return new Map()
  const rows = await db
    .select({
      postId: postAttachments.postId,
      totalAttachments: sql<number>`count(*)`,
      totalSize: sql<number | null>`sum(${postAttachments.fileSize})`,
      imageCount: sql<number>`sum(case when ${postAttachments.fileType} = 'image' then 1 else 0 end)`,
      documentCount: sql<number>`sum(case when ${postAttachments.fileType} = 'document' then 1 else 0 end)`,
      videoCount: sql<number>`sum(case when ${postAttachments.fileType} = 'video' then 1 else 0 end)`,
      audioCount: sql<number>`sum(case when ${postAttachments.fileType} = 'audio' then 1 else 0 end)`,
    })
    .from(postAttachments)
    .where(and(inArray(postAttachments.postId, postIds), eq(postAttachments.isTemporary, false)))
    .groupBy(postAttachments.postId)
  return new Map(
    rows.map(row => [
      row.postId,
      {
        total_attachments: Number(row.totalAttachments),
        total_size: Number(row.totalSize ?? 0),
        image_count: Number(row.imageCount),
        document_count: Number(row.documentCount),
        video_count: Number(row.videoCount),
        audio_count: Number(row.audioCount),
      },
    ])
  )
}

/**
 * 첨부파일 업로드 제한 확인에 쓰는 집계(개수 + 총 용량). 단일 쿼리 —
 * 게시글마다 전체 행을 내려받아 JS에서 합산하지 않는다.
 */
export async function getAttachmentUploadStats(
  postId: string
): Promise<{ count: number; total_size: number }> {
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
      totalSize: sql<number | null>`sum(${postAttachments.fileSize})`,
    })
    .from(postAttachments)
    .where(eq(postAttachments.postId, postId))
  return { count: Number(rows[0]?.count ?? 0), total_size: Number(rows[0]?.totalSize ?? 0) }
}

/*
 * 대표 이미지 해제를 하는 `unsetPrimaryForPost`는 없앴다. 이 함수가 밖에
 * 노출돼 있으면 "해제"와 "지정"이 다시 두 호출로 갈라지고, 그 사이가
 * 벌어져 대표가 둘이 되는 경합이 되살아난다. 해제는 `addAttachment`와
 * `updateAttachment`가 각자의 트랜잭션 안에서만 한다. 마지막 방어선은
 * DB의 부분 유니크 인덱스 `post_attachments_primary_idx`(마이그레이션 0015)다.
 */

export type AttachmentPatch = Partial<{
  alt_text: string | null
  is_primary: boolean
  sort_order: number
}>

/**
 * 첨부파일 일부 컬럼(대체 텍스트/대표 이미지 여부/정렬 순서)을 갱신한다.
 * `updated_at`은 스키마의 `$onUpdate` 훅이 자동으로 채운다. patch가 빈
 * 객체면 쿼리 없이 현재 행을 그대로 돌려준다.
 * @returns 행이 없으면(id/post_id가 안 맞으면) `null`.
 */
export async function updateAttachment(
  id: string,
  postId: string,
  patch: AttachmentPatch
): Promise<PostAttachmentRow | null> {
  const values: Record<string, unknown> = {}
  if (patch.alt_text !== undefined) values.altText = patch.alt_text
  if (patch.is_primary !== undefined) values.isPrimary = patch.is_primary
  if (patch.sort_order !== undefined) values.sortOrder = patch.sort_order

  if (Object.keys(values).length === 0) {
    return getAttachmentById(id, postId)
  }

  // 대표 이미지 지정은 "남의 대표 해제 + 내 대표 지정"이 반드시 함께 일어나야
  // 한다. 라우트가 두 호출로 나눠 하던 시절에는 서로 다른 첨부를 대표로
  // 지정하는 두 요청이 겹칠 때 둘 다 is_primary=true로 남을 수 있었다.
  const rows = await db.transaction(async tx => {
    if (values.isPrimary === true) {
      await tx
        .update(postAttachments)
        .set({ isPrimary: false })
        .where(
          and(
            eq(postAttachments.postId, postId),
            eq(postAttachments.isPrimary, true),
            ne(postAttachments.id, id)
          )
        )
    }
    return tx
      .update(postAttachments)
      .set(values as Partial<typeof postAttachments.$inferInsert>)
      .where(and(eq(postAttachments.id, id), eq(postAttachments.postId, postId)))
      .returning()
  })
  return rows[0] ? rowToAttachment(rows[0]) : null
}

/** id + post_id로 첨부파일 한 건을 삭제한다(하드 삭제 — 기존 동작 그대로). */
export async function removeAttachment(id: string, postId: string): Promise<void> {
  await db
    .delete(postAttachments)
    .where(and(eq(postAttachments.id, id), eq(postAttachments.postId, postId)))
}

/*
 * 임시 첨부(`is_temporary`) 관련 함수들은 걷어냈다 — `listTemporaryAttachments`,
 * `deleteExpiredTempAttachments`, 그리고 그것들을 부르던
 * `/api/cleanup/temp-attachments` 크론까지.
 *
 * 그 개념이 **도달할 수 없었기 때문이다.** 임시 첨부는 `post_id`가
 * `temp-{UUID}`인 행으로 만들어지게 돼 있었는데, 업로드 라우트의 POST는
 * `validateUUID`로 그런 id를 400으로 거부한다. 프론트도 글을 먼저 만들고
 * 진짜 id로 올린다(`CreatePostForm` → `uploadAttachments(postId)`). 운영
 * DB에도 `is_temporary = 1`인 행이 0건이었다(2026-09-02 실측). 즉 크론은
 * 매번 0건을 지우고 있었다.
 *
 * 컬럼(`is_temporary`·`temp_session`·`expires_at`)은 남겨 둔다 — 지워서
 * 얻는 것이 없고 SQLite에서 컬럼을 없애려면 표를 재작성해야 한다.
 */
