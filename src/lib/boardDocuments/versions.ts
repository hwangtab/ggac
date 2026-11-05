import { z } from 'zod'
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
  isBoardDocumentVersionBlobPathOf,
  isBoardDocumentVersionPathOf,
  isSafeBoardDocumentFilePath,
} from '@/lib/storage/boardDocuments'
import { canOfferAppEdit } from '@work/lib/files/app-edit'
import type { ObjectsDropped } from '@work/lib/files/doc-edit-types'
import { inspectEditorSave } from '@work/lib/files/editor-save-inspect'
import { scheduleBoardDocumentTextExtraction } from '@work/lib/files/extract-schedule'
import { extractMarkdown } from '@work/lib/files/extract-text'
import { hwpEditFormatOf } from '@work/lib/files/hwp-editor'
import { resolveMime } from '@work/lib/files/mime'
import { OFFICE_EDIT_MAX_BYTES } from '@work/lib/files/office-edit'
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
  savedDisplayName,
  type BodyPlan,
} from './editRules'
import {
  boardDocumentObjectPath,
  copyBoardDocumentObject,
  downloadBoardDocumentObject,
  hasBoardDocumentEditStore,
  readBoardDocumentObject,
  removeBoardDocumentObjects,
  statBoardDocumentObject,
} from './storage'

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
export type ServiceResult<T> = { ok: boolean; data?: T; status?: number; error?: string }

function fail<T>(status: number, error: string): ServiceResult<T> {
  return { ok: false, status, error }
}

const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** 저장본의 크기 상한 — HWP·HWPX 20MB(업무툴 DOC_EDIT_MAX_BYTES), 오피스 50MB(OFFICE_EDIT_MAX_BYTES) */
function maxBytesFor(name: string): number {
  return hwpEditFormatOf(name) ? DOC_EDIT_MAX_BYTES : OFFICE_EDIT_MAX_BYTES
}

/** 앱에서 고칠 수 있는 서류인가(이 배포의 편집기 env·형식·크기) — 업로드 준비와 저장이 같은 판정을 쓴다 */
function editableHere(doc: BoardDocumentEditRow): boolean {
  return canOfferAppEdit(currentFileName(doc), doc.fileSize ?? 0)
}

/** 저장본 키: `versions/<서류>/<업로드 id>/<ASCII 안전 이름>`(file_path 칸 값). 이름은 지금 이름 본체 + 저장본 확장자 */
function savedFilePath(doc: BoardDocumentEditRow, uploadId: string, savedName: string) {
  const name = savedDisplayName(currentFileName(doc), savedName)
  const filePath = boardDocumentVersionFilePath(doc.id, uploadId, sanitizeFileName(name))
  return { name, filePath }
}

export type EditUploadTarget = {
  uploadId: string
  pathname: string
  mime: string
  multipart: boolean
}

const prepareSchema = z.object({
  type: z.literal('prepare'),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1),
})

/**
 * ① 저장본 업로드 준비 — 이 배포에서 앱 편집할 수 있는 서류인지, 저장본 이름이 같은 형식인지, 크기가 편집기 상한 안인지를
 * 보고 키를 정한다. 임시 업로드 행을 두지 않는다: 키가 `versions/<이 서류>/<새 uuid>/…`로 서버가 정한 모양이라, 토큰
 * 발급(②)과 승격(③)이 같은 판정을 다시 할 수 있다(05 §3-3).
 */
export function prepareEditUpload(
  doc: BoardDocumentEditRow,
  body: unknown
): ServiceResult<EditUploadTarget> {
  const parsed = prepareSchema.safeParse(body)
  if (!parsed.success) return fail(400, '파일 정보가 올바르지 않습니다.')
  if (!editableHere(doc))
    return fail(415, '이 서류는 앱에서 편집할 수 없는 형식이거나 너무 큽니다.')
  const current = currentFileName(doc)
  if (!isCompatibleSavedName(current, parsed.data.name)) {
    return fail(415, '원본과 같은 형식으로만 저장할 수 있습니다.')
  }
  if (parsed.data.size > maxBytesFor(current)) {
    return fail(
      413,
      hwpEditFormatOf(current) ? '파일이 20MB를 넘습니다.' : '파일이 50MB를 넘습니다.'
    )
  }
  if (!hasBoardDocumentEditStore()) return fail(503, '파일 저장소가 설정되지 않았습니다.')
  const uploadId = crypto.randomUUID()
  const { name, filePath } = savedFilePath(doc, uploadId, parsed.data.name)
  if (!filePath) return fail(400, '파일 정보가 올바르지 않습니다.')
  return {
    ok: true,
    data: {
      uploadId,
      pathname: boardDocumentObjectPath(filePath),
      mime: resolveMime('', name),
      multipart: parsed.data.size > MULTIPART_THRESHOLD_BYTES,
    },
  }
}

/**
 * ② 업로드 토큰 판정 — 브라우저가 보낸 pathname 이 **이 서류의 버전 키**이고 업로드 id 구간이 `clientPayload`와 같으며
 * 형식이 원본과 맞을 때만. 토큰은 그 형식 하나·편집기 상한까지(덮어쓰기·무작위 접미사 없이 — 라우트가 끈다).
 */
export function decideEditUploadToken(
  doc: BoardDocumentEditRow,
  uploadId: string,
  pathname: string
): ServiceResult<{ allowedContentTypes: string[]; maximumSizeInBytes: number }> {
  if (!editableHere(doc))
    return fail(415, '이 서류는 앱에서 편집할 수 없는 형식이거나 너무 큽니다.')
  if (!isBoardDocumentVersionBlobPathOf(pathname, doc.id)) {
    return fail(403, '업로드 경로가 일치하지 않습니다.')
  }
  const segments = pathname.split('/')
  // board-documents / versions / <서류> / <업로드 id> / <이름>
  if (segments[3]?.toLowerCase() !== uploadId.toLowerCase()) {
    return fail(403, '업로드 경로가 일치하지 않습니다.')
  }
  const fileSegment = segments[4] ?? ''
  const current = currentFileName(doc)
  if (!isCompatibleSavedName(current, fileSegment)) {
    return fail(403, '원본과 같은 형식으로만 저장할 수 있습니다.')
  }
  return {
    ok: true,
    data: {
      allowedContentTypes: [resolveMime('', fileSegment)],
      maximumSizeInBytes: maxBytesFor(current),
    },
  }
}

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
  const discard = () => removeBoardDocumentObjects([objectPath]).catch(() => undefined)
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
      if (!isSafeBoardDocumentFilePath(doc.filePath)) return fail(404, '서류를 찾을 수 없습니다.')
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
