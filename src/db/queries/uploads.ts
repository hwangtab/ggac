/**
 * 에디터 업로드 원장 쿼리 계층 (Turso/Drizzle).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 이 함수를
 * 부를 자격이 있는지는 라우트가 판정하고, 여기는 검증된 값만 받는다.
 *
 * 이 계층이 답하는 질문은 하나다: "올라왔지만 아무 데서도 참조하지 않는
 * 파일은 무엇인가." 참조는 두 곳에만 있다 —
 *   1) 게시글 본문(`posts.content`)에 박힌 URL 문자열
 *   2) 첨부 원장(`post_attachments.file_url`)
 * 그래서 후보 판정은 이 둘에 대한 NOT EXISTS다.
 */

import { and, desc, eq, lt, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { mediaUploads } from '../schema/index.ts'

import { toIso, toSnakeCase } from './_helpers.ts'

/** 업로드가 참조되지 않은 채로 이 기간을 넘기면 정리 후보가 된다. */
export const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 한 번의 정리 실행이 건드리는 최대 건수. Blob 삭제가 건당 네트워크 왕복이다. */
export const CLEANUP_BATCH_LIMIT = 100

export type RecordUploadInput = {
  user_id: string | null
  bucket: string
  path: string
  url: string
  mime_type?: string | null
  size_bytes?: number | null
}

function rowToUpload(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

/**
 * 업로드 사실을 기록한다.
 *
 * 같은 URL이 다시 올라오는 경우(같은 요청 재시도, `overwrite: true`로 덮어쓴
 * 변형 파일)에는 새 행을 만들지 않는다 — 유니크 위반으로 던지는 대신 조용히
 * 넘어가는 편이 맞다. 원장의 목적은 "이 URL이 존재한다"를 아는 것이지 업로드
 * 횟수를 세는 것이 아니다.
 */
export async function recordUpload(input: RecordUploadInput) {
  const [row] = await db
    .insert(mediaUploads)
    .values({
      userId: input.user_id ?? null,
      bucket: input.bucket,
      path: input.path,
      url: input.url,
      mimeType: input.mime_type ?? null,
      sizeBytes: input.size_bytes ?? null,
    })
    .onConflictDoNothing({ target: mediaUploads.url })
    .returning()

  return row ? rowToUpload(row) : null
}

/** 한 회원이 올린 기록. 최신순. */
export async function listUploadsByUser(userId: string, limit = 50) {
  const rows = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.userId, userId))
    .orderBy(desc(mediaUploads.createdAt))
    .limit(limit)

  return rows.map(rowToUpload)
}

export async function getUploadByUrl(url: string) {
  const [row] = await db.select().from(mediaUploads).where(eq(mediaUploads.url, url)).limit(1)
  return row ? rowToUpload(row) : null
}

/**
 * 정리 후보 — 충분히 오래됐고, 어디에서도 참조하지 않는 업로드.
 *
 * 참조 검사를 LIKE가 아니라 `instr(content, url) > 0`으로 하는 이유: URL에는
 * `%`·`_`가 들어갈 수 있고(인코딩된 파일명), LIKE는 그걸 와일드카드로 읽는다.
 * `instr`은 순수 부분문자열 검사라 이스케이프가 필요 없다.
 *
 * 삭제된 게시글(`is_deleted = 1`)은 참조로 치지 않는다. 소프트 삭제된 글의
 * 본문은 화면 어디에도 나오지 않으므로 그 안의 이미지를 붙들고 있을 이유가
 * 없다. (되살리기 기능이 생긴다면 이 판정을 먼저 바꿔야 한다.)
 */
export async function listCleanupCandidates(
  options: { now?: number; ageMs?: number; limit?: number } = {}
) {
  const now = options.now ?? Date.now()
  const ageMs = options.ageMs ?? CLEANUP_AGE_MS
  const limit = options.limit ?? CLEANUP_BATCH_LIMIT
  const cutoff = new Date(now - ageMs)

  const rows = await db
    .select()
    .from(mediaUploads)
    .where(
      and(
        lt(mediaUploads.createdAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM posts WHERE is_deleted = 0 AND instr(content, ${mediaUploads.url}) > 0)`,
        sql`NOT EXISTS (SELECT 1 FROM post_attachments WHERE file_url = ${mediaUploads.url})`
      )
    )
    .orderBy(mediaUploads.createdAt)
    .limit(limit)

  return rows.map(rowToUpload)
}

/** 정리가 끝난(Blob에서 실제로 지운) 기록을 원장에서 지운다. */
export async function deleteUpload(id: string): Promise<boolean> {
  const deleted = await db.delete(mediaUploads).where(eq(mediaUploads.id, id)).returning({
    id: mediaUploads.id,
  })
  return deleted.length > 0
}
