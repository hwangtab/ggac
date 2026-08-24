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

import { and, asc, eq, lt, ne, sql, type SQL } from 'drizzle-orm'

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

/** `post_id`로 첨부파일 목록을 `sort_order` 오름차순으로 조회한다. */
export async function listAttachments(postId: string): Promise<PostAttachmentRow[]> {
  const rows = await db
    .select()
    .from(postAttachments)
    .where(eq(postAttachments.postId, postId))
    .orderBy(asc(postAttachments.sortOrder))
  return rows.map(rowToAttachment)
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

/**
 * 같은 게시글 안의 대표 이미지(`is_primary`)를 전부 해제한다. 새 대표 이미지를
 * 지정하기 전에 부른다. `excludeAttachmentId`를 넘기면 그 첨부는 건드리지
 * 않는다(수정 라우트가 "자기 자신은 그대로 두고 나머지만 해제"할 때 씀).
 */
export async function unsetPrimaryForPost(
  postId: string,
  excludeAttachmentId?: string
): Promise<void> {
  const conditions: SQL[] = [
    eq(postAttachments.postId, postId),
    eq(postAttachments.isPrimary, true),
  ]
  if (excludeAttachmentId) {
    conditions.push(ne(postAttachments.id, excludeAttachmentId))
  }
  await db
    .update(postAttachments)
    .set({ isPrimary: false })
    .where(and(...conditions))
}

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

  const rows = await db
    .update(postAttachments)
    .set(values as Partial<typeof postAttachments.$inferInsert>)
    .where(and(eq(postAttachments.id, id), eq(postAttachments.postId, postId)))
    .returning()
  return rows[0] ? rowToAttachment(rows[0]) : null
}

/** id + post_id로 첨부파일 한 건을 삭제한다(하드 삭제 — 기존 동작 그대로). */
export async function removeAttachment(id: string, postId: string): Promise<void> {
  await db
    .delete(postAttachments)
    .where(and(eq(postAttachments.id, id), eq(postAttachments.postId, postId)))
}

/** 만료 여부를 따지지 않고 임시 첨부(`is_temporary = true`) 전체를 조회한다.
 * `/api/cleanup/temp-attachments` GET(통계)이 만료/활성 분류를 직접
 * 계산할 때 쓴다. */
export async function listTemporaryAttachments(): Promise<PostAttachmentRow[]> {
  const rows = await db.select().from(postAttachments).where(eq(postAttachments.isTemporary, true))
  return rows.map(rowToAttachment)
}

/**
 * 만료된 임시 첨부(`is_temporary = true AND expires_at < now`)를 삭제하고,
 * 삭제된 행을 돌려준다 — 호출부(cleanup 라우트)가 그 `file_url`로 Storage
 * 파일도 지운다.
 *
 * 원래 Supabase 구현은 "만료분 SELECT → Storage 삭제 시도 → id로 DELETE"
 * 순서였다. 이 함수는 SQLite `DELETE ... RETURNING`으로 조회+삭제를 원자적
 * 단일 문장으로 합친다 — **무엇이 삭제되는지(조건)는 100% 동일**하게
 * 옮겼지만, DB 삭제와 Storage 삭제의 순서가 바뀐다(DB가 먼저 지워진 뒤 그
 * 결과로 Storage를 지운다). 만료된 임시 첨부는 애초에 24시간 TTL의 미게시
 * 초안 파일이라 이 순서 변경의 실질적 위험은 낮다고 판단했다 — 자세한 근거는
 * task-5-report.md "남은 우려" 참고.
 */
export async function deleteExpiredTempAttachments(
  now: Date = new Date()
): Promise<PostAttachmentRow[]> {
  const rows = await db
    .delete(postAttachments)
    .where(and(eq(postAttachments.isTemporary, true), lt(postAttachments.expiresAt, now)))
    .returning()
  return rows.map(rowToAttachment)
}
