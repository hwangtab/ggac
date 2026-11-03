/**
 * 업무툴 첨부 본문 추출 결과 쿼리 계층 — 원본 kosmart-work `work.attachment_texts`(0029)와 service_role 이 쓰던
 * RPC `attachments_pending_extraction`·upsert 를 옮겼다(설계 §8-2). 원본 `lib/files/extract-store.ts`의 DB 부분이다.
 *
 * **권한을 모른다.** 이 모듈은 추출 라우트(`/api/internal/board-work/extract-texts`, CRON_SECRET)만 부른다 —
 * 사람의 요청이 닿는 길이 아니다. 검색에서 이 표를 읽는 쪽(`search.ts`)이 읽기 범위를 WHERE 에 넣는다.
 *
 * 대신 원본 DB 제약이 지키던 것은 여기서 지킨다(ggac 는 CHECK 를 두지 않는다):
 * - status 허용값(ok·unsupported·failed·too_large), 본문 2,000,000자 상한 → 넘으면 WorkWriteError('invalid')
 * - 결과 행의 채널은 **첨부의 채널**이다(호출부가 넘긴 값을 믿지 않고 첨부 행에서 다시 읽는다 — 다른 채널 id 로
 *   저장되면 검색 범위 판정이 그 채널 기준으로 어긋난다)
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workAttachments, workAttachmentTexts, workMessages } from '../../schema/index.ts'

import { WorkWriteError } from './_shared.ts'

export const ATTACHMENT_TEXT_STATUSES = ['ok', 'unsupported', 'failed', 'too_large'] as const
export type AttachmentTextStatus = (typeof ATTACHMENT_TEXT_STATUSES)[number]

/** 원본 0029 `attachment_texts_content_len` CHECK 와 같은 값(extract-text.ts EXTRACT_MAX_CHARS) */
export const ATTACHMENT_TEXT_MAX_CHARS = 2_000_000

/** 원본 RPC 의 limit 상한 */
const PENDING_LIMIT_MAX = 20_000

/** 추출 대상 하나(원본 attachments_pending_extraction 결과 모양). `bucket_path`는 Blob 키다 */
export type PendingExtractionRow = {
  id: string
  channel_id: string
  name: string
  size: number
  bucket_path: string
  /** 지금까지의 시도 횟수(행이 없으면 0) */
  attempts: number
}

/** 확장자 목록 → `lower(name) like '%.<ext>'` OR 식. 확장자는 상수 목록(사용자 입력이 아니다)이지만 모양을 다시 본다 */
function extensionFilter(exts: readonly string[]) {
  const safe = [...new Set(exts.map(e => e.toLowerCase()))].filter(e => /^[a-z0-9]{1,10}$/.test(e))
  if (safe.length === 0) return sql`0`
  return or(...safe.map(e => sql`lower(${workAttachments.name}) like ${`%.${e}`}`))
}

/**
 * 원본 attachments_pending_extraction(0029): 확장자가 목록에 있고, 살아 있는 메시지의 첨부이며, 아직 결과 행이 없거나
 * failed 이고 시도 횟수가 maxAttempts 미만이며 retryBefore 보다 먼저 시도한 것. 최신 순.
 */
export async function listPendingExtractionRows(opts: {
  exts: readonly string[]
  limit: number
  maxAttempts: number
  /** 이 시각보다 먼저 시도한 failed 만 다시 집는다(원본 extracted_at < now() - p_retry_after) */
  retryBefore: Date
}): Promise<PendingExtractionRow[]> {
  const limit = Math.min(Math.max(Math.floor(opts.limit) || 1, 1), PENDING_LIMIT_MAX)
  const rows = await db
    .select({
      id: workAttachments.id,
      channelId: workAttachments.channelId,
      name: workAttachments.name,
      size: workAttachments.size,
      blobPath: workAttachments.blobPath,
      attempts: workAttachmentTexts.attempts,
    })
    .from(workAttachments)
    .innerJoin(
      workMessages,
      and(eq(workMessages.id, workAttachments.messageId), isNull(workMessages.deletedAt))
    )
    .leftJoin(workAttachmentTexts, eq(workAttachmentTexts.attachmentId, workAttachments.id))
    .where(
      and(
        extensionFilter(opts.exts),
        or(
          isNull(workAttachmentTexts.attachmentId),
          and(
            eq(workAttachmentTexts.status, 'failed'),
            lt(workAttachmentTexts.attempts, opts.maxAttempts),
            lt(workAttachmentTexts.extractedAt, opts.retryBefore)
          )
        )
      )
    )
    .orderBy(desc(workAttachments.createdAt), desc(workAttachments.id))
    .limit(limit)
  return rows.map(r => ({
    id: r.id,
    channel_id: r.channelId,
    name: r.name,
    size: r.size,
    bucket_path: r.blobPath,
    attempts: r.attempts ?? 0,
  }))
}

/** 업로드 직후 훅용 — 지정한 첨부(최대 20)와 결과 행 유무. 지워진 메시지의 첨부는 빼고 돌려준다 */
export async function getExtractionCandidates(
  ids: readonly string[]
): Promise<Array<PendingExtractionRow & { done: boolean }>> {
  const list = [...new Set(ids)].slice(0, 20)
  if (list.length === 0) return []
  const rows = await db
    .select({
      id: workAttachments.id,
      channelId: workAttachments.channelId,
      name: workAttachments.name,
      size: workAttachments.size,
      blobPath: workAttachments.blobPath,
      textId: workAttachmentTexts.attachmentId,
      attempts: workAttachmentTexts.attempts,
    })
    .from(workAttachments)
    .innerJoin(
      workMessages,
      and(eq(workMessages.id, workAttachments.messageId), isNull(workMessages.deletedAt))
    )
    .leftJoin(workAttachmentTexts, eq(workAttachmentTexts.attachmentId, workAttachments.id))
    .where(inArray(workAttachments.id, list))
  return rows.map(r => ({
    id: r.id,
    channel_id: r.channelId,
    name: r.name,
    size: r.size,
    bucket_path: r.blobPath,
    attempts: r.attempts ?? 0,
    done: r.textId !== null,
  }))
}

export type AttachmentTextWrite = {
  attachmentId: string
  ext: string
  content: string
  truncated: boolean
  status: AttachmentTextStatus
  extractorVersion: string
  attempts: number
  extractedAt?: Date
}

function assertWrite(w: AttachmentTextWrite): void {
  if (!(ATTACHMENT_TEXT_STATUSES as readonly string[]).includes(w.status)) {
    throw new WorkWriteError('invalid', `알 수 없는 추출 상태: ${w.status}`)
  }
  if (w.content.length > ATTACHMENT_TEXT_MAX_CHARS) {
    throw new WorkWriteError('invalid', '본문이 저장 상한(2,000,000자)을 넘습니다')
  }
  if (w.status !== 'ok' && w.content !== '') {
    throw new WorkWriteError('invalid', 'ok 가 아닌 결과에는 본문을 두지 않습니다')
  }
}

/** 결과 행의 채널 = 첨부의 채널. 첨부가 없으면 not_found */
async function attachmentChannel(attachmentId: string): Promise<string> {
  const [a] = await db
    .select({ channelId: workAttachments.channelId })
    .from(workAttachments)
    .where(eq(workAttachments.id, attachmentId))
    .limit(1)
  if (!a) throw new WorkWriteError('not_found', '첨부가 없습니다')
  return a.channelId
}

/**
 * 추출을 시작하기 **전에** failed 행을 남긴다(선점 — 원본 claimTarget). 처음(attempts=0 → 1)이면 이미 행이 있을 때
 * 아무것도 하지 않고(다른 실행이 먼저 만든 행·완료 행을 건드리지 않음), 재시도면 **아직 failed 인 행만** 갱신한다
 * (그 사이 다른 실행이 ok 로 만든 행을 failed 로 되돌리지 않는다).
 */
export async function claimAttachmentText(input: {
  attachmentId: string
  ext: string
  extractorVersion: string
  /** 이번 시도 번호(= 이전 시도 횟수 + 1) */
  attempts: number
  extractedAt?: Date
}): Promise<void> {
  const channelId = await attachmentChannel(input.attachmentId)
  const row = {
    attachmentId: input.attachmentId,
    channelId,
    ext: input.ext,
    content: '',
    truncated: false,
    status: 'failed' as const,
    extractorVersion: input.extractorVersion,
    attempts: input.attempts,
    extractedAt: input.extractedAt ?? new Date(),
  }
  if (input.attempts <= 1) {
    await db.insert(workAttachmentTexts).values(row).onConflictDoNothing()
    return
  }
  await db
    .update(workAttachmentTexts)
    .set(row)
    .where(
      and(
        eq(workAttachmentTexts.attachmentId, input.attachmentId),
        eq(workAttachmentTexts.status, 'failed')
      )
    )
}

/** 최종 결과 저장(원본 upsert onConflict attachment_id) */
export async function upsertAttachmentText(w: AttachmentTextWrite): Promise<void> {
  assertWrite(w)
  const channelId = await attachmentChannel(w.attachmentId)
  const row = {
    attachmentId: w.attachmentId,
    channelId,
    ext: w.ext,
    content: w.content,
    truncated: w.truncated,
    status: w.status,
    extractorVersion: w.extractorVersion,
    attempts: w.attempts,
    extractedAt: w.extractedAt ?? new Date(),
  }
  await db
    .insert(workAttachmentTexts)
    .values(row)
    .onConflictDoUpdate({
      target: workAttachmentTexts.attachmentId,
      set: {
        channelId: row.channelId,
        ext: row.ext,
        content: row.content,
        truncated: row.truncated,
        status: row.status,
        extractorVersion: row.extractorVersion,
        attempts: row.attempts,
        extractedAt: row.extractedAt,
      },
    })
}

export type AttachmentTextRecord = {
  attachmentId: string
  channelId: string
  ext: string
  contentLength: number
  truncated: boolean
  status: string
  extractorVersion: string
  attempts: number
  extractedAt: Date
}

/** 결과 행 하나(본문 길이만 — 점검·테스트용). 없으면 null */
export async function getAttachmentTextRecord(
  attachmentId: string
): Promise<AttachmentTextRecord | null> {
  const [r] = await db
    .select({
      attachmentId: workAttachmentTexts.attachmentId,
      channelId: workAttachmentTexts.channelId,
      ext: workAttachmentTexts.ext,
      contentLength: sql<number>`length(${workAttachmentTexts.content})`,
      truncated: workAttachmentTexts.truncated,
      status: workAttachmentTexts.status,
      extractorVersion: workAttachmentTexts.extractorVersion,
      attempts: workAttachmentTexts.attempts,
      extractedAt: workAttachmentTexts.extractedAt,
    })
    .from(workAttachmentTexts)
    .where(eq(workAttachmentTexts.attachmentId, attachmentId))
    .limit(1)
  return r ? { ...r, contentLength: Number(r.contentLength) } : null
}
