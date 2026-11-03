/**
 * 이사회 서류(`board_documents`) 파일 본문 추출 결과 쿼리 계층 — `work_board_document_texts`(0034, 03 §10).
 * 업무툴 첨부 쪽(`texts.ts` — `work_attachment_texts`)과 같은 규칙(대상 고르기·선점·재시도 상한·저장 상한)을
 * 서류 행에 맞춰 옮겼다. 추출 파이프라인(`src/work/lib/files/extract-store.ts`)이 두 출처를 함께 돈다.
 *
 * **권한을 모른다.** 이 모듈은 추출 라우트(`/api/internal/board-work/extract-texts`, CRON_SECRET)만 부른다 —
 * 사람의 요청이 닿는 길이 아니다. 검색에서 이 표를 읽는 쪽(`searchDocuments`, `../board.ts`)이 서류 행의
 * `visibility`로 열람 범위를 WHERE 에 넣는다.
 *
 * 서류 원본의 저장 경로(`file_path`)는 그대로 돌려줄 뿐 판정하지 않는다 — 읽는 쪽(extract-store)이
 * `isSafeBoardDocumentFilePath`를 지난 경로만 서류 저장소(`getBoardDocumentStream`)로 읽는다.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import { boardDocuments, workBoardDocumentTexts } from '../../schema/index.ts'

import { WorkWriteError } from './_shared.ts'
import {
  ATTACHMENT_TEXT_MAX_CHARS,
  ATTACHMENT_TEXT_STATUSES,
  type AttachmentTextStatus,
} from './texts.ts'

/** 원본 RPC 의 limit 상한과 같다(texts.ts) */
const PENDING_LIMIT_MAX = 20_000

/** 추출 대상 서류 하나. `file_path`는 서류 저장소 키(`board-documents/` 아래 상대 경로)다 */
export type PendingBoardDocumentRow = {
  id: string
  /** 확장자를 읽는 이름 — 파일 이름, 없으면 저장 경로(`<owner>/<시각>_<안전한 이름>`) */
  name: string
  /** 행의 크기(없으면 0 — 추출기가 실제 바이트로 한 번 더 막는다) */
  size: number
  file_path: string
  /** 지금까지의 시도 횟수(행이 없으면 0) */
  attempts: number
  /** 올린 시각(epoch ms) — 첨부와 섞어 최신 순으로 처리할 때 */
  created_at: number
}

/** 확장자를 읽는 이름 — 파일 이름이 비면 저장 경로(서버가 만든 이름이라 확장자를 지닌다) */
const nameExpr = sql<string>`coalesce(nullif(${boardDocuments.fileName}, ''), ${boardDocuments.filePath})`

/** 확장자 목록 → `lower(name) like '%.<ext>'` OR 식(texts.ts 와 같은 모양 검사) */
function extensionFilter(exts: readonly string[]) {
  const safe = [...new Set(exts.map(e => e.toLowerCase()))].filter(e => /^[a-z0-9]{1,10}$/.test(e))
  if (safe.length === 0) return sql`0`
  return or(...safe.map(e => sql`lower(${nameExpr}) like ${`%.${e}`}`))
}

function toPending(r: {
  id: string
  name: string
  size: number | null
  filePath: string
  attempts: number | null
  createdAt: Date
}): PendingBoardDocumentRow {
  return {
    id: r.id,
    name: r.name,
    size: r.size ?? 0,
    file_path: r.filePath,
    attempts: r.attempts ?? 0,
    created_at: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
  }
}

/**
 * 추출 대상 서류: 확장자가 목록에 있고, 아직 결과 행이 없거나 failed 이고 시도 횟수가 maxAttempts 미만이며
 * retryBefore 보다 먼저 시도한 것. 최신 순(첨부 쪽 `listPendingExtractionRows`와 같은 규칙).
 */
export async function listPendingBoardDocumentTextRows(opts: {
  exts: readonly string[]
  limit: number
  maxAttempts: number
  retryBefore: Date
}): Promise<PendingBoardDocumentRow[]> {
  const limit = Math.min(Math.max(Math.floor(opts.limit) || 1, 1), PENDING_LIMIT_MAX)
  const rows = await db
    .select({
      id: boardDocuments.id,
      name: nameExpr,
      size: boardDocuments.fileSize,
      filePath: boardDocuments.filePath,
      attempts: workBoardDocumentTexts.attempts,
      createdAt: boardDocuments.createdAt,
    })
    .from(boardDocuments)
    .leftJoin(workBoardDocumentTexts, eq(workBoardDocumentTexts.documentId, boardDocuments.id))
    .where(
      and(
        extensionFilter(opts.exts),
        or(
          isNull(workBoardDocumentTexts.documentId),
          and(
            eq(workBoardDocumentTexts.status, 'failed'),
            lt(workBoardDocumentTexts.attempts, opts.maxAttempts),
            lt(workBoardDocumentTexts.extractedAt, opts.retryBefore)
          )
        )
      )
    )
    .orderBy(desc(boardDocuments.createdAt), desc(boardDocuments.id))
    .limit(limit)
  return rows.map(toPending)
}

/** 업로드 직후 훅용 — 지정한 서류(최대 20)와 결과 행 유무 */
export async function getBoardDocumentExtractionCandidates(
  ids: readonly string[]
): Promise<Array<PendingBoardDocumentRow & { done: boolean }>> {
  const list = [...new Set(ids)].slice(0, 20)
  if (list.length === 0) return []
  const rows = await db
    .select({
      id: boardDocuments.id,
      name: nameExpr,
      size: boardDocuments.fileSize,
      filePath: boardDocuments.filePath,
      textId: workBoardDocumentTexts.documentId,
      attempts: workBoardDocumentTexts.attempts,
      createdAt: boardDocuments.createdAt,
    })
    .from(boardDocuments)
    .leftJoin(workBoardDocumentTexts, eq(workBoardDocumentTexts.documentId, boardDocuments.id))
    .where(inArray(boardDocuments.id, list))
  return rows.map(r => ({ ...toPending(r), done: r.textId !== null }))
}

export type BoardDocumentTextWrite = {
  documentId: string
  ext: string
  content: string
  truncated: boolean
  status: AttachmentTextStatus
  extractorVersion: string
  attempts: number
  extractedAt?: Date
}

function assertWrite(w: BoardDocumentTextWrite): void {
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

/** 서류가 있는가 — 없으면 not_found(지워진 서류의 결과 행을 남기지 않는다. FK 오류 대신 분명한 오류로) */
async function assertDocument(documentId: string): Promise<void> {
  const [d] = await db
    .select({ id: boardDocuments.id })
    .from(boardDocuments)
    .where(eq(boardDocuments.id, documentId))
    .limit(1)
  if (!d) throw new WorkWriteError('not_found', '서류가 없습니다')
}

/**
 * 추출을 시작하기 **전에** failed 행을 남긴다(선점 — texts.ts `claimAttachmentText`와 같다). 처음(attempts 1)이면
 * 이미 행이 있을 때 아무것도 하지 않고, 재시도면 **아직 failed 인 행만** 갱신한다.
 */
export async function claimBoardDocumentText(input: {
  documentId: string
  ext: string
  extractorVersion: string
  attempts: number
  extractedAt?: Date
}): Promise<void> {
  await assertDocument(input.documentId)
  const row = {
    documentId: input.documentId,
    ext: input.ext,
    content: '',
    truncated: false,
    status: 'failed' as const,
    extractorVersion: input.extractorVersion,
    attempts: input.attempts,
    extractedAt: input.extractedAt ?? new Date(),
  }
  if (input.attempts <= 1) {
    await db.insert(workBoardDocumentTexts).values(row).onConflictDoNothing()
    return
  }
  await db
    .update(workBoardDocumentTexts)
    .set(row)
    .where(
      and(
        eq(workBoardDocumentTexts.documentId, input.documentId),
        eq(workBoardDocumentTexts.status, 'failed')
      )
    )
}

/** 최종 결과 저장(onConflict document_id) */
export async function upsertBoardDocumentText(w: BoardDocumentTextWrite): Promise<void> {
  assertWrite(w)
  await assertDocument(w.documentId)
  const row = {
    documentId: w.documentId,
    ext: w.ext,
    content: w.content,
    truncated: w.truncated,
    status: w.status,
    extractorVersion: w.extractorVersion,
    attempts: w.attempts,
    extractedAt: w.extractedAt ?? new Date(),
  }
  await db
    .insert(workBoardDocumentTexts)
    .values(row)
    .onConflictDoUpdate({
      target: workBoardDocumentTexts.documentId,
      set: {
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

export type BoardDocumentTextRecord = {
  documentId: string
  ext: string
  contentLength: number
  truncated: boolean
  status: string
  extractorVersion: string
  attempts: number
  extractedAt: Date
}

/** 결과 행 하나(본문 길이만 — 점검·테스트용). 없으면 null */
export async function getBoardDocumentTextRecord(
  documentId: string
): Promise<BoardDocumentTextRecord | null> {
  const [r] = await db
    .select({
      documentId: workBoardDocumentTexts.documentId,
      ext: workBoardDocumentTexts.ext,
      contentLength: sql<number>`length(${workBoardDocumentTexts.content})`,
      truncated: workBoardDocumentTexts.truncated,
      status: workBoardDocumentTexts.status,
      extractorVersion: workBoardDocumentTexts.extractorVersion,
      attempts: workBoardDocumentTexts.attempts,
      extractedAt: workBoardDocumentTexts.extractedAt,
    })
    .from(workBoardDocumentTexts)
    .where(eq(workBoardDocumentTexts.documentId, documentId))
    .limit(1)
  return r ? { ...r, contentLength: Number(r.contentLength) } : null
}
