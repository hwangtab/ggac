/**
 * 이사회 서류 버전 기록(`board_document_versions`, 마이그레이션 0037) 쿼리 계층 — docs/board-work/05-이사회-서류-앱-편집.md §2.
 *
 * 이 모듈은 **권한을 모른다.** `NextResponse`·`next/headers`·인가 모듈을 임포트하지 않는다. "올린 사람 또는 관리자만
 * 고친다"는 라우트(`/api/board-room/documents/[id]/…`)가 `requireBoardMember()` 뒤에 판정하고, 이 모듈의 쓰기 함수는
 * 그 판정을 지난 뒤에만 불린다.
 *
 * 규칙:
 * - **backfill 없음.** 버전 행이 없는 서류는 `board_documents`의 file_* 칸이 v1 이다. 처음 저장할 때 같은 트랜잭션에서
 *   그 칸을 v1 행으로 옮기고 새 버전을 넣는다(`addBoardDocumentVersion`).
 * - 새 버전을 넣으면 같은 트랜잭션에서 `board_documents`의 file_*·`body_markdown`을 그 버전으로 바꾸고, 파일 본문 추출
 *   결과(`work_board_document_texts`)를 지운다 — 검색이 옛 파일의 글자를 내주지 않게, 그리고 추출 대상
 *   (`listPendingBoardDocumentTextRows`: 결과 행이 없는 서류)으로 돌아가게.
 * - 지나간 버전 행은 고치지 않는다. 되돌리기도 새 버전이다.
 * - 응답 모양은 camelCase(업무툴·문서함 쿼리와 같다). 화면에는 라우트가 고른 칸만 나간다(경로는 싣지 않는다).
 */

import { and, desc, eq, max } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  boardDocumentVersions,
  boardDocuments,
  memberProfiles,
  workBoardDocumentTexts,
} from '../schema/index.ts'

/** 쓰기 실패 — 라우트가 상태 코드로 바꾼다(not_found 404 · conflict 409) */
export class BoardDocumentVersionWriteError extends Error {
  // node --test(strip-only)는 매개변수 속성을 읽지 못한다 — 필드를 따로 둔다
  readonly code: 'not_found' | 'conflict'
  constructor(code: 'not_found' | 'conflict', message: string) {
    super(message)
    this.code = code
    this.name = 'BoardDocumentVersionWriteError'
  }
}

/** 편집 라우트가 판정·저장에 쓰는 서류 한 건(본문 포함) */
export type BoardDocumentEditRow = {
  id: string
  title: string
  category: string
  filePath: string
  fileName: string | null
  fileSize: number | null
  mimeType: string | null
  uploadedBy: string | null
  visibility: string
  bodyMarkdown: string | null
  createdAt: Date
}

export async function getBoardDocumentForEdit(id: string): Promise<BoardDocumentEditRow | null> {
  const [row] = await db
    .select({
      id: boardDocuments.id,
      title: boardDocuments.title,
      category: boardDocuments.category,
      filePath: boardDocuments.filePath,
      fileName: boardDocuments.fileName,
      fileSize: boardDocuments.fileSize,
      mimeType: boardDocuments.mimeType,
      uploadedBy: boardDocuments.uploadedBy,
      visibility: boardDocuments.visibility,
      bodyMarkdown: boardDocuments.bodyMarkdown,
      createdAt: boardDocuments.createdAt,
    })
    .from(boardDocuments)
    .where(eq(boardDocuments.id, id))
    .limit(1)
  return row ?? null
}

export type BoardDocumentVersionRow = {
  id: string
  documentId: string
  versionNo: number
  filePath: string
  fileName: string
  fileSize: number
  mimeType: string
  source: string
  createdBy: string | null
  /** 저장한 사람의 표시 이름(지워진 회원·시드 서류는 null) */
  createdByName: string | null
  bodyMarkdown: string | null
  createdAt: Date
}

const versionColumns = {
  id: boardDocumentVersions.id,
  documentId: boardDocumentVersions.documentId,
  versionNo: boardDocumentVersions.versionNo,
  filePath: boardDocumentVersions.filePath,
  fileName: boardDocumentVersions.fileName,
  fileSize: boardDocumentVersions.fileSize,
  mimeType: boardDocumentVersions.mimeType,
  source: boardDocumentVersions.source,
  createdBy: boardDocumentVersions.createdBy,
  createdByName: memberProfiles.displayName,
  bodyMarkdown: boardDocumentVersions.bodyMarkdown,
  createdAt: boardDocumentVersions.createdAt,
}

/** 서류의 버전 기록(최신 먼저). 한 번도 고치지 않은 서류는 빈 배열 */
export async function listBoardDocumentVersions(
  documentId: string
): Promise<BoardDocumentVersionRow[]> {
  return db
    .select(versionColumns)
    .from(boardDocumentVersions)
    .leftJoin(memberProfiles, eq(memberProfiles.id, boardDocumentVersions.createdBy))
    .where(eq(boardDocumentVersions.documentId, documentId))
    .orderBy(desc(boardDocumentVersions.versionNo))
}

/** 이 서류의 버전 하나. 다른 서류의 버전 id 면 null(서류 id 를 WHERE 에 함께 넣는다) */
export async function getBoardDocumentVersion(
  documentId: string,
  versionId: string
): Promise<BoardDocumentVersionRow | null> {
  const [row] = await db
    .select(versionColumns)
    .from(boardDocumentVersions)
    .leftJoin(memberProfiles, eq(memberProfiles.id, boardDocumentVersions.createdBy))
    .where(
      and(eq(boardDocumentVersions.documentId, documentId), eq(boardDocumentVersions.id, versionId))
    )
    .limit(1)
  return row ?? null
}

/** 버전 행의 가장 큰 번호. 행이 없으면 null(지금 파일이 v1) */
export async function latestRecordedVersionNo(documentId: string): Promise<number | null> {
  const [row] = await db
    .select({ n: max(boardDocumentVersions.versionNo) })
    .from(boardDocumentVersions)
    .where(eq(boardDocumentVersions.documentId, documentId))
  return row?.n ?? null
}

/** 서류의 모든 버전 파일 경로(서류 삭제 때 객체를 지운다) */
export async function listBoardDocumentVersionPaths(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ filePath: boardDocumentVersions.filePath })
    .from(boardDocumentVersions)
    .where(eq(boardDocumentVersions.documentId, documentId))
  return rows.map(r => r.filePath)
}

export type NewBoardDocumentVersion = {
  /** 객체 키의 버전 uuid 구간과 같다 */
  id: string
  filePath: string
  fileName: string
  fileSize: number
  mimeType: string
  source: 'office-editor' | 'hwp-editor' | 'revert'
  createdBy: string
}

/**
 * 새 버전 넣기(편집기 저장·되돌리기 공용) — 한 트랜잭션:
 *  1. 서류가 있어야 한다(없으면 not_found)
 *  2. `baseVersionNo`가 지금 최신이 아니면 conflict(다른 사람이 먼저 저장 — 덮지 않는다). null 이면 보지 않는다
 *  3. 버전 행이 없으면 지금 file_* 칸을 v1 로 옮긴다(올린 사람·올린 때·지금 본문)
 *  4. 새 버전(최신 + 1)을 넣고 `board_documents`의 file_*·`body_markdown`을 그것으로 바꾼다
 *  5. 파일 본문 추출 결과를 지운다(새 파일로 다시 뽑는다)
 * `body`가 `keep`이면 본문을 바꾸지 않는다(본문이 없던 서류·다시 만들기 실패). 새 버전 행의 본문 기록은 바뀐 뒤의 본문이다.
 */
export async function addBoardDocumentVersion(input: {
  documentId: string
  baseVersionNo: number | null
  version: NewBoardDocumentVersion
  body: { mode: 'keep' } | { mode: 'set'; value: string | null }
  /** 되돌리기면 원본 버전 id — 이 서류의 지나간 버전이어야 한다(아니면 not_found, 최신이면 conflict) */
  revertFromVersionId?: string | null
  now?: Date
}): Promise<{ versionId: string; versionNo: number; initialVersionId: string | null }> {
  const now = input.now ?? new Date()
  return db.transaction(async tx => {
    const [doc] = await tx
      .select()
      .from(boardDocuments)
      .where(eq(boardDocuments.id, input.documentId))
      .limit(1)
    if (!doc) throw new BoardDocumentVersionWriteError('not_found', '서류를 찾을 수 없습니다.')

    const [top] = await tx
      .select({ n: max(boardDocumentVersions.versionNo) })
      .from(boardDocumentVersions)
      .where(eq(boardDocumentVersions.documentId, doc.id))
    const recorded = top?.n ?? null
    const latestNo = recorded ?? 1
    if (input.baseVersionNo !== null && input.baseVersionNo !== latestNo) {
      throw new BoardDocumentVersionWriteError(
        'conflict',
        `다른 곳에서 먼저 v${latestNo}을 저장했습니다. 새로 연 뒤 다시 저장해 주세요.`
      )
    }

    if (input.revertFromVersionId) {
      const [from] = await tx
        .select({ versionNo: boardDocumentVersions.versionNo })
        .from(boardDocumentVersions)
        .where(
          and(
            eq(boardDocumentVersions.documentId, doc.id),
            eq(boardDocumentVersions.id, input.revertFromVersionId)
          )
        )
        .limit(1)
      if (!from) throw new BoardDocumentVersionWriteError('not_found', '버전을 찾을 수 없습니다.')
      if (from.versionNo === latestNo) {
        throw new BoardDocumentVersionWriteError('conflict', '이미 최신 버전입니다.')
      }
    }

    let initialVersionId: string | null = null
    if (recorded === null) {
      initialVersionId = crypto.randomUUID()
      await tx.insert(boardDocumentVersions).values({
        id: initialVersionId,
        documentId: doc.id,
        versionNo: 1,
        filePath: doc.filePath,
        fileName: doc.fileName?.trim() || doc.title,
        fileSize: doc.fileSize ?? 0,
        mimeType: doc.mimeType || 'application/octet-stream',
        source: 'upload',
        createdBy: doc.uploadedBy,
        bodyMarkdown: doc.bodyMarkdown,
        createdAt: doc.createdAt,
      })
    }

    const bodyAfter = input.body.mode === 'set' ? input.body.value : doc.bodyMarkdown
    const versionNo = latestNo + 1
    await tx.insert(boardDocumentVersions).values({
      id: input.version.id,
      documentId: doc.id,
      versionNo,
      filePath: input.version.filePath,
      fileName: input.version.fileName,
      fileSize: input.version.fileSize,
      mimeType: input.version.mimeType,
      source: input.version.source,
      createdBy: input.version.createdBy,
      bodyMarkdown: bodyAfter,
      createdAt: now,
    })
    await tx
      .update(boardDocuments)
      .set({
        filePath: input.version.filePath,
        fileName: input.version.fileName,
        fileSize: input.version.fileSize,
        mimeType: input.version.mimeType,
        bodyMarkdown: bodyAfter,
      })
      .where(eq(boardDocuments.id, doc.id))
    await tx.delete(workBoardDocumentTexts).where(eq(workBoardDocumentTexts.documentId, doc.id))
    return { versionId: input.version.id, versionNo, initialVersionId }
  })
}
