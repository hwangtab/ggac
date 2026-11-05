import {
  addBoardDocumentVersion,
  BoardDocumentVersionWriteError,
  getBoardDocumentVersion,
  latestRecordedVersionNo,
  type BoardDocumentEditRow,
} from '@/db/queries/boardDocumentVersions'
import { logUserActivity } from '@/db/queries/activities'
import {
  boardDocumentVersionFilePath,
  isBoardDocumentVersionPathOf,
  isSafeBoardDocumentFilePath,
} from '@/lib/storage/boardDocuments'
import type { ObjectsDropped } from '@work/lib/files/doc-edit-types'
import { inspectEditorSave } from '@work/lib/files/editor-save-inspect'
import { scheduleBoardDocumentTextExtraction } from '@work/lib/files/extract-schedule'
import { extractMarkdown } from '@work/lib/files/extract-text'
import { hwpEditFormatOf } from '@work/lib/files/hwp-editor'
import { resolveMime } from '@work/lib/files/mime'
import { sanitizeFileName } from '@work/lib/files/paths'
import { StorageUnconfiguredError } from '@work/lib/files/private-store'
import { removeBoardDocumentRenderCache } from '@work/lib/files/render-cache-cleanup'
import { DOC_EDIT_MAX_BYTES } from '@work/lib/files/render-types'
import { StorageUnavailableError } from '@work/lib/files/storage-errors'
import { storedContentTypeMatches } from '@work/lib/files/upload-rules'
import { logSecurityEvent } from '@/utils/security'
import {
  bodyPlanAfterRevert,
  bodyPlanAfterSave,
  currentFileName,
  editorSourceFor,
  isCompatibleSavedName,
  type BodyPlan,
} from './editRules'
import {
  boardDocumentObjectPath,
  copyBoardDocumentObject,
  downloadBoardDocumentObject,
  readBoardDocumentObject,
  removeBoardDocumentObjects,
  statBoardDocumentObject,
} from './storage'

import {
  fail,
  ZIP_MAGIC,
  OLE2_MAGIC,
  maxBytesFor,
  editableHere,
  savedFilePath,
  type ServiceResult,
} from './editUploads'

export { currentFileName }

/**
 * 이사회 서류 앱 편집의 서버 단계(라우트가 `requireBoardMember()` → 레이트 리밋 → 서류 행·편집 판정을 끝낸 **뒤에**
 * 부른다) — docs/board-work/05-이사회-서류-앱-편집.md §4·§5. 권한 판정은 하지 않는다: 넘겨받은 서류 행(`doc`)은 이미
 * "올린 사람 또는 관리자" 판정을 지났다. 객체 경로는 늘 `isBoardDocumentVersionPathOf(path, doc.id)`로 한 번 더 본다.
 *
 * HWP·HWPX 저장본 검사와 웹 본문 다시 만들기가 kordoc 을 부르므로 이 모듈을 쓰는 라우트(`/versions`)는
 * next.config.js `KORDOC_ROUTES`에 있다.
 *
 * 결과는 한 모양(strict: false 라 판별 유니온이 좁혀지지 않는다): `ok`가 거짓이면 `status`·`error`가 있다.
 */
export { prepareEditUpload, decideEditUploadToken } from './editUploads'
export type { ServiceResult, EditUploadTarget } from './editUploads'

export type SaveResult = {
  documentId: string
  versionId: string
  versionNo: number
  name: string
  /** 웹 본문을 새 파일로 다시 만들었는가 — 본문이 없던 서류는 null, 다시 만들기에 실패해 이전 본문을 뒀으면 false */
  bodyUpdated: boolean | null
  objectsDropped?: ObjectsDropped
}

function storageFailure<T>(e: unknown): ServiceResult<T> {
  if (e instanceof StorageUnconfiguredError) return fail(503, '파일 저장소가 설정되지 않았습니다.')
  if (e instanceof StorageUnavailableError) {
    return fail(503, '저장소가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  throw e
}

function writeFailure<T>(e: unknown): ServiceResult<T> {
  if (e instanceof BoardDocumentVersionWriteError) {
    return fail(e.code === 'not_found' ? 404 : 409, e.message)
  }
  throw e
}

async function startsWith(path: string, magic: number[]): Promise<boolean> {
  const object = await readBoardDocumentObject(path, { range: { start: 0, end: magic.length - 1 } })
  if (!object) return false
  const head = new Uint8Array(await new Response(object.stream).arrayBuffer()).subarray(
    0,
    magic.length
  )
  return magic.every((b, i) => head[i] === b)
}

/**
 * 웹 본문 정하기 — `plan`대로. 다시 만들기는 kordoc 마크다운(검색 추출과 같은 보호 장치)이고, 실패하면 지금 본문을 둔다
 * (`keep` — 사무국이 다듬은 본문을 잃지 않는다). 본문 내용은 어디에도 기록하지 않는다.
 */
async function resolveBody(
  plan: BodyPlan,
  readBytes: () => Promise<Buffer>,
  name: string,
  documentId: string
): Promise<{
  body: { mode: 'keep' } | { mode: 'set'; value: string | null }
  updated: boolean | null
}> {
  if (plan.kind === 'none') return { body: { mode: 'set', value: null }, updated: null }
  if (plan.kind === 'snapshot') return { body: { mode: 'set', value: plan.value }, updated: true }
  try {
    const out = await extractMarkdown(await readBytes(), name)
    if (out.status === 'ok') return { body: { mode: 'set', value: out.markdown }, updated: true }
    console.warn('[board-documents/versions] 웹 본문을 다시 만들지 못했다 — 이전 본문을 둔다', {
      documentId,
      status: out.status,
    })
  } catch (e) {
    console.warn('[board-documents/versions] 웹 본문 다시 만들기 실패 — 이전 본문을 둔다', {
      documentId,
      error: e instanceof Error ? e.name : typeof e,
    })
  }
  return { body: { mode: 'keep' }, updated: false }
}

/** 새 버전이 생긴 뒤 — 검색 본문 다시 뽑기 예약, 미리보기 캐시 지우기. 둘 다 던지지 않는다(크론·다음 열람이 따라잡는다) */
async function afterNewVersion(documentId: string): Promise<void> {
  scheduleBoardDocumentTextExtraction([documentId])
  await removeBoardDocumentRenderCache(documentId, e =>
    console.warn('[board-documents/versions] 미리보기 캐시 삭제 실패', {
      documentId,
      error: e instanceof Error ? e.name : typeof e,
    })
  )
}

/**
 * ③ 편집기 저장본 → 새 버전. 객체가 실제로 있고(크기·형식이 상한·원본과 맞고), 오피스는 OOXML(ZIP) 머리, HWP·HWPX 는
 * kordoc 검사(업무툴·문서함과 같은 `inspectEditorSave` — 원본은 지금 최신 파일)를 지나야 한다. 막히면 객체를 치우고 422.
 * `baseVersionNo`가 지금 최신이 아니면 409(다른 사람이 먼저 저장 — 덮지 않는다).
 */
export async function saveEditedVersion(
  doc: BoardDocumentEditRow,
  userId: string,
  input: { uploadId: string; name: string; baseVersionNo: number | null }
): Promise<ServiceResult<SaveResult>> {
  if (!editableHere(doc))
    return fail(415, '이 서류는 앱에서 편집할 수 없는 형식이거나 너무 큽니다.')
  const current = currentFileName(doc)
  if (!isCompatibleSavedName(current, input.name)) {
    return fail(415, '원본과 같은 형식으로만 저장할 수 있습니다.')
  }
  const source = editorSourceFor(current)
  if (source !== 'office-editor' && source !== 'hwp-editor') {
    return fail(415, '이 서류는 앱에서 편집할 수 없는 형식입니다.')
  }
  const { name, filePath } = savedFilePath(doc, input.uploadId, input.name)
  if (!filePath || !isBoardDocumentVersionPathOf(filePath, doc.id)) {
    return fail(404, '올린 파일을 찾을 수 없습니다. 다시 저장해 주세요.')
  }
  const objectPath = boardDocumentObjectPath(filePath)
  const mime = resolveMime('', name)
  const max = maxBytesFor(current)

  // 같은 업로드 id 로 다시 온 저장(응답이 늦어 다시 누름·프록시 재시도)은 이미 승격된 것이다 — 그 객체는 지금 서류의 최신
  // 파일이라 아래 검사·실패 처리가 지우면 서류가 통째로 404 가 된다(2026-11-05 리뷰). 객체를 건드리지 않고 같은 결과를 돌려준다.
  const already = await getBoardDocumentVersion(doc.id, input.uploadId).catch(() => null)
  if (already) {
    return {
      ok: true,
      data: {
        documentId: doc.id,
        versionId: already.id,
        versionNo: already.versionNo,
        name: already.fileName ?? name,
        bodyUpdated: false,
      },
    }
  }
  // 저장본을 치울 때는 **어떤 버전 행도 그 업로드를 가리키지 않을 때만** 지운다 — 같은 업로드가 동시에 두 번 와서 한쪽이
  // 먼저 승격했으면 그 객체가 최신 파일이다. 확인 조회가 실패하면 지우지 않는다(고아 객체가 남는 쪽이 되돌릴 수 있다).
  const discard = async () => {
    if (objectPath === boardDocumentObjectPath(doc.filePath)) return
    const claimed = await getBoardDocumentVersion(doc.id, input.uploadId).then(
      row => row !== null,
      () => true
    )
    if (claimed) return
    await removeBoardDocumentObjects([objectPath]).catch(() => undefined)
  }
  const blocked = async (reason: string) => {
    await discard()
    return fail<SaveResult>(
      422,
      `${reason} 이 서류는 앱에서 저장하기 어렵습니다 — 내려받아 고친 뒤 서류함에 새로 올려 주세요.`
    )
  }

  let stat: Awaited<ReturnType<typeof statBoardDocumentObject>>
  try {
    stat = await statBoardDocumentObject(objectPath)
  } catch (e) {
    return storageFailure(e)
  }
  if (!stat) return fail(409, '업로드가 완료되지 않았습니다. 다시 저장해 주세요.')
  if (stat.size > max)
    return blocked(
      max === DOC_EDIT_MAX_BYTES ? '파일이 20MB를 넘습니다.' : '파일이 50MB를 넘습니다.'
    )
  if (stat.size === 0) return blocked('빈 파일입니다.')
  if (!storedContentTypeMatches(stat.contentType, mime))
    return blocked('파일 형식이 맞지 않습니다.')

  let savedBytes: Buffer | null = null
  const readSaved = async (): Promise<Buffer> => {
    if (!savedBytes) savedBytes = await downloadBoardDocumentObject(objectPath)
    return savedBytes
  }
  let objectsDropped: ObjectsDropped | null = null
  const format = hwpEditFormatOf(current)
  try {
    if (format) {
      if (!isSafeBoardDocumentFilePath(doc.filePath)) {
        await discard()
        return fail(404, '서류를 찾을 수 없습니다.')
      }
      if ((doc.fileSize ?? 0) > DOC_EDIT_MAX_BYTES) return blocked('파일이 20MB를 넘습니다.')
      const [original, saved] = await Promise.all([
        downloadBoardDocumentObject(boardDocumentObjectPath(doc.filePath)),
        readSaved(),
      ])
      if (original.length > DOC_EDIT_MAX_BYTES || saved.length > DOC_EDIT_MAX_BYTES) {
        return blocked('파일이 20MB를 넘습니다.')
      }
      const inspected = await inspectEditorSave({
        format,
        // 원본 쪽 수 캐시 키는 서류 id — 자료실 미리보기(`board-work/renders/<서류 id>-…`)와 같은 키라 이미 그린 쪽 목록을
        // 그대로 쓰고, 저장 뒤 그 캐시를 지운다(afterNewVersion)
        original: { bytes: original, cacheKey: doc.id, name: current },
        saved,
        name,
      })
      if (inspected.blockedReason) return blocked(inspected.blockedReason)
      objectsDropped = inspected.objectsDropped
    } else if (!(await startsWith(objectPath, ZIP_MAGIC))) {
      return blocked('저장된 파일이 올바른 문서 형식이 아닙니다.')
    }
  } catch (e) {
    if (e instanceof StorageUnconfiguredError || e instanceof StorageUnavailableError) {
      return storageFailure(e)
    }
    // 원본·저장본을 읽지 못했다(객체 없음 등) — 저장본은 치운다
    await discard()
    return fail(503, '원본 파일을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  if (format === 'hwp' && savedBytes && !OLE2_MAGIC.every((b, i) => savedBytes[i] === b)) {
    return blocked('저장된 파일이 올바른 한글 문서가 아닙니다.')
  }

  const resolved = await resolveBody(bodyPlanAfterSave(doc.bodyMarkdown), readSaved, name, doc.id)
  let added: Awaited<ReturnType<typeof addBoardDocumentVersion>>
  try {
    added = await addBoardDocumentVersion({
      documentId: doc.id,
      baseVersionNo: input.baseVersionNo,
      version: {
        id: input.uploadId,
        filePath,
        fileName: name,
        fileSize: stat.size,
        mimeType: mime,
        source,
        createdBy: userId,
      },
      body: resolved.body,
    })
  } catch (e) {
    await discard()
    if (e instanceof BoardDocumentVersionWriteError) return writeFailure(e)
    // 같은 업로드 id 를 두 번 승격(PK 충돌) 등 — 객체는 이미 치웠다
    console.error('[board-documents/versions] 새 버전 저장 실패', {
      documentId: doc.id,
      error: e instanceof Error ? e.name : typeof e,
    })
    return fail(409, '이미 저장된 파일이거나 저장하지 못했습니다. 새로 연 뒤 다시 저장해 주세요.')
  }
  await afterNewVersion(doc.id)
  return {
    ok: true,
    data: {
      documentId: doc.id,
      versionId: added.versionId,
      versionNo: added.versionNo,
      name,
      bodyUpdated: resolved.updated,
      ...(objectsDropped ? { objectsDropped } : {}),
    },
  }
}

export type RevertResult = SaveResult & { fromVersionNo: number }

/**
 * 되돌리기 — 고른 버전의 객체를 새 키로 **복사해** 새 최신 버전을 만든다(지나간 행·객체는 그대로). 웹 본문은 그 버전의
 * 본문 기록으로 돌아간다(`bodyPlanAfterRevert`). 이미 최신이면 409, 다른 서류의 버전 id 면 404.
 */
export async function revertToVersion(
  doc: BoardDocumentEditRow,
  userId: string,
  fromVersionId: string
): Promise<ServiceResult<RevertResult>> {
  const from = await getBoardDocumentVersion(doc.id, fromVersionId)
  if (!from) return fail(404, '버전을 찾을 수 없습니다.')
  const latestNo = (await latestRecordedVersionNo(doc.id)) ?? 1
  if (from.versionNo === latestNo) return fail(409, '이미 최신 버전입니다.')
  if (!isSafeBoardDocumentFilePath(from.filePath)) {
    logSecurityEvent('BOARD_DOCUMENT_VERSION_PATH_REJECTED', { documentId: doc.id }, 'high')
    return fail(404, '버전을 찾을 수 없습니다.')
  }

  const id = crypto.randomUUID()
  const to = boardDocumentVersionFilePath(doc.id, id, sanitizeFileName(from.fileName))
  if (!to) return fail(400, '버전 정보가 올바르지 않습니다.')
  const toPath = boardDocumentObjectPath(to)
  try {
    await copyBoardDocumentObject(boardDocumentObjectPath(from.filePath), toPath)
  } catch (e) {
    if (e instanceof StorageUnconfiguredError)
      return fail(503, '파일 저장소가 설정되지 않았습니다.')
    return fail(503, '버전 파일을 복사하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }

  const resolved = await resolveBody(
    bodyPlanAfterRevert(from.bodyMarkdown, doc.bodyMarkdown),
    () => downloadBoardDocumentObject(toPath),
    from.fileName,
    doc.id
  )
  let added: Awaited<ReturnType<typeof addBoardDocumentVersion>>
  try {
    added = await addBoardDocumentVersion({
      documentId: doc.id,
      baseVersionNo: latestNo,
      version: {
        id,
        filePath: to,
        fileName: from.fileName,
        fileSize: from.fileSize,
        mimeType: from.mimeType,
        source: 'revert',
        createdBy: userId,
      },
      body: resolved.body,
      revertFromVersionId: from.id,
    })
  } catch (e) {
    await removeBoardDocumentObjects([toPath]).catch(() => undefined)
    return writeFailure(e)
  }
  await afterNewVersion(doc.id)
  return {
    ok: true,
    data: {
      documentId: doc.id,
      versionId: added.versionId,
      versionNo: added.versionNo,
      name: from.fileName,
      bodyUpdated: resolved.updated,
      fromVersionNo: from.versionNo,
    },
  }
}

/**
 * 활동 기록 — 누가 언제 어느 서류를 몇 번 버전으로 저장·되돌렸는지. **문서 내용·파일 이름은 싣지 않는다**(05 §6).
 * 기록 실패는 저장(본 작업)을 막지 않는다 — 보안 로그로 남긴다(메일함 첨부 다운로드 기록과 같은 모양).
 */
export async function recordBoardDocumentEdit(
  request: Request,
  input: {
    userId: string
    isAdmin: boolean
    action: 'board_document_version_saved' | 'board_document_version_reverted'
    documentId: string
    versionNo: number
    source: string
    fileSize?: number | null
    fromVersionNo?: number
  }
): Promise<void> {
  try {
    await logUserActivity({
      user_id: input.userId,
      action_type: input.action,
      target_type: 'board_document',
      target_id: input.documentId,
      metadata: {
        version_no: input.versionNo,
        source: input.source,
        ...(input.fromVersionNo ? { from_version_no: input.fromVersionNo } : {}),
        ...(typeof input.fileSize === 'number' ? { size_bytes: input.fileSize } : {}),
        is_admin: input.isAdmin,
      },
      ip_address:
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      user_agent: request.headers.get('user-agent') || null,
    })
  } catch (e) {
    logSecurityEvent(
      'BOARD_DOCUMENT_EDIT_AUDIT_FAILED',
      { documentId: input.documentId, error: e instanceof Error ? e.name : typeof e },
      'high'
    )
  }
}
