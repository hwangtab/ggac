import {
  addMemberDocumentVersion,
  createMemberDocumentFromUpload,
  deleteOwnedMemberDocumentUpload,
  getOwnedMemberDocument,
  getOwnedMemberDocumentUpload,
  type MemberDocumentPendingRow,
} from '@/db/queries/memberDocuments'
import { isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import { inspectHwpEditorSave, inspectHwpxEditorSave } from '@work/lib/files/doc-edit'
import { originalPageCount, renderPages } from '@work/lib/files/doc-edit-pages'
import {
  BLOCKED_MESSAGE,
  pageCountBlocked,
  type ObjectsDropped,
} from '@work/lib/files/doc-edit-types'
import { hwpEditFormatOf } from '@work/lib/files/hwp-editor'
import { DOC_EDIT_MAX_BYTES } from '@work/lib/files/render-types'
import { MEMBER_DOCUMENT_MAX_COUNT, renameWithExtension, type MemberDocumentSource } from './rules'
import {
  confirmUploaded,
  fail,
  writeErrorResult,
  type PromoteResult,
  type ServiceResult,
} from './service'
import { downloadMemberDocumentObject, removeMemberDocumentObjects } from './storage'

/**
 * 임시 업로드 승격(새 문서 v1 · 새 버전) — 서버 전용. HWP·HWPX 편집기 저장본은 kordoc 으로 검사하므로 이 모듈만
 * kordoc 을 부른다(그래서 이 모듈을 쓰는 라우트 둘 — `/api/mypage/documents`·`/[id]/versions` — 만 next.config.js
 * `KORDOC_ROUTES`에 있다. 다른 문서함 라우트·화면은 `service.ts`만 쓴다). 게이트·스위치·레이트 리밋은 라우트가 끝냈다.
 * docs/board-work/04-조합원-문서함.md §9.
 */

export type EditorInspection = {
  blockedReason: string | null
  objectsDropped: ObjectsDropped | null
}

/**
 * HWP·HWPX 편집기 저장본 서버 검사(업무툴 drafts/verify 라우트와 같은 판정을 한 번에): 형식·kordoc 다시 읽기·블록 수,
 * HWP 는 쪽 수 비교. HWPX 개체 감소는 막지 않고 알린다. 원본이 없으면(새 HWPX 문서) 저장본만 본다.
 */
async function inspectEditorSave(input: {
  format: 'hwp' | 'hwpx'
  original: { bytes: Buffer; versionId: string; name: string } | null
  saved: Buffer
  name: string
}): Promise<EditorInspection> {
  const startedAt = Date.now()
  if (input.format === 'hwpx') {
    const r = await inspectHwpxEditorSave(input.original?.bytes ?? null, input.saved)
    return { blockedReason: r.blockedReason, objectsDropped: r.objectsDropped }
  }
  if (!input.original) return { blockedReason: BLOCKED_MESSAGE.original, objectsDropped: null }
  const r = await inspectHwpEditorSave(input.original.bytes, input.saved)
  if (r.blockedReason) return { blockedReason: r.blockedReason, objectsDropped: null }
  const layout = await renderPages(input.saved, input.name, startedAt, 1)
  const before = await originalPageCount(
    input.original.versionId,
    input.original.bytes,
    input.original.name,
    startedAt
  )
  const after = layout && !layout.truncated ? layout.pages.length : null
  if (pageCountBlocked(before, after))
    return { blockedReason: BLOCKED_MESSAGE.pages, objectsDropped: null }
  return { blockedReason: null, objectsDropped: null }
}

/** 저장본 검사가 필요한 승격인가(편집기에서 저장한 HWP·HWPX) */
function editorFormatOf(source: MemberDocumentSource, name: string): 'hwp' | 'hwpx' | null {
  return source === 'editor' ? hwpEditFormatOf(name) : null
}

async function readBounded(path: string, max: number): Promise<Buffer | null> {
  const bytes = await downloadMemberDocumentObject(path)
  return bytes.length > max ? null : bytes
}

async function blockedSave<T>(ownerId: string, pending: MemberDocumentPendingRow, reason: string) {
  await removeMemberDocumentObjects([pending.blobPath]).catch(() => undefined)
  await deleteOwnedMemberDocumentUpload(ownerId, pending.id).catch(() => undefined)
  return fail<T>(
    422,
    `${reason} 이 문서는 앱에서 저장하기 어렵습니다 — 내려받아 한글에서 고친 뒤 새 버전으로 올려 주세요.`
  )
}

/** 임시 업로드 → 새 문서 v1. 편집기에서 처음 저장한 새 HWPX 는 저장본 검사를 거친다 */
export async function createMemberDocument(
  ownerId: string,
  input: { uploadId: string; source: MemberDocumentSource }
): Promise<ServiceResult<PromoteResult>> {
  const pending = await getOwnedMemberDocumentUpload(ownerId, input.uploadId)
  if (!pending || pending.documentId !== null)
    return fail(404, '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
  const confirmed = await confirmUploaded(ownerId, pending)
  if (!confirmed.ok) return fail(confirmed.status, confirmed.error)

  let objectsDropped: ObjectsDropped | null = null
  const format = editorFormatOf(input.source, pending.name)
  if (format) {
    if (pending.size > DOC_EDIT_MAX_BYTES)
      return blockedSave(ownerId, pending, '파일이 20MB를 넘습니다.')
    const saved = await readBounded(pending.blobPath, DOC_EDIT_MAX_BYTES)
    if (!saved) return blockedSave(ownerId, pending, '파일이 20MB를 넘습니다.')
    const inspected = await inspectEditorSave({ format, original: null, saved, name: pending.name })
    if (inspected.blockedReason) return blockedSave(ownerId, pending, inspected.blockedReason)
    objectsDropped = inspected.objectsDropped
  }

  try {
    const created = await createMemberDocumentFromUpload({
      ownerId,
      uploadId: pending.id,
      version: {
        name: pending.name,
        mime: pending.mime,
        size: pending.size,
        blobPath: pending.blobPath,
        source: input.source,
      },
      maxDocuments: MEMBER_DOCUMENT_MAX_COUNT,
    })
    return {
      ok: true,
      data: {
        documentId: created.documentId,
        versionId: created.versionId,
        versionNo: 1,
        name: pending.name,
        ...(objectsDropped ? { objectsDropped } : {}),
      },
    }
  } catch (e) {
    const r = writeErrorResult<PromoteResult>(e)
    if (r.status === 413) {
      await removeMemberDocumentObjects([pending.blobPath]).catch(() => undefined)
      await deleteOwnedMemberDocumentUpload(ownerId, pending.id).catch(() => undefined)
    }
    return r
  }
}

/**
 * 내 문서에 새 버전 — 업로드(`uploadId`, 올리기·편집기 저장). 편집기 저장(HWP·HWPX)은 기준 버전 원본과 비교 검사한다.
 * `baseVersionNo`가 지금 최신이 아니면 409(다른 탭에서 먼저 저장).
 */
export async function addUploadedVersion(
  ownerId: string,
  documentId: string,
  input: { uploadId: string; source: MemberDocumentSource; baseVersionNo: number | null }
): Promise<ServiceResult<PromoteResult>> {
  const doc = await getOwnedMemberDocument(ownerId, documentId)
  if (!doc) return fail(404, '문서를 찾을 수 없습니다.')
  const pending = await getOwnedMemberDocumentUpload(ownerId, input.uploadId)
  if (!pending || pending.documentId !== documentId) {
    return fail(404, '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
  }
  if (input.baseVersionNo !== null && input.baseVersionNo !== doc.document.latestVersionNo) {
    return fail(
      409,
      `다른 곳에서 먼저 v${doc.document.latestVersionNo}을 저장했습니다. 새로 연 뒤 다시 저장해 주세요.`
    )
  }
  const confirmed = await confirmUploaded(ownerId, pending)
  if (!confirmed.ok) return fail(confirmed.status, confirmed.error)

  let objectsDropped: ObjectsDropped | null = null
  const format = editorFormatOf(input.source, pending.name)
  if (format) {
    const base =
      doc.versions.find(
        v => v.versionNo === (input.baseVersionNo ?? doc.document.latestVersionNo)
      ) ?? null
    if (!base || hwpEditFormatOf(base.name) !== format) {
      return blockedSave(ownerId, pending, '원본과 같은 형식으로만 저장할 수 있습니다.')
    }
    if (pending.size > DOC_EDIT_MAX_BYTES || base.size > DOC_EDIT_MAX_BYTES) {
      return blockedSave(ownerId, pending, '파일이 20MB를 넘습니다.')
    }
    let original: Buffer | null
    let saved: Buffer | null
    try {
      if (!isMemberDocumentPathOf(base.blobPath, ownerId))
        return fail(404, '문서를 찾을 수 없습니다.')
      ;[original, saved] = await Promise.all([
        readBounded(base.blobPath, DOC_EDIT_MAX_BYTES),
        readBounded(pending.blobPath, DOC_EDIT_MAX_BYTES),
      ])
    } catch {
      return fail(503, '원본 파일을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    }
    if (!original || !saved) return blockedSave(ownerId, pending, '파일이 20MB를 넘습니다.')
    const inspected = await inspectEditorSave({
      format,
      original: { bytes: original, versionId: base.id, name: base.name },
      saved,
      name: pending.name,
    })
    if (inspected.blockedReason) return blockedSave(ownerId, pending, inspected.blockedReason)
    objectsDropped = inspected.objectsDropped
  }

  const name = renameWithExtension(doc.document.name, pending.name)
  try {
    const added = await addMemberDocumentVersion({
      ownerId,
      documentId,
      uploadId: pending.id,
      baseVersionNo: input.baseVersionNo,
      version: {
        id: pending.id,
        name,
        mime: pending.mime,
        size: pending.size,
        blobPath: pending.blobPath,
        source: input.source,
      },
    })
    return {
      ok: true,
      data: {
        documentId,
        versionId: added.versionId,
        versionNo: added.versionNo,
        name,
        ...(objectsDropped ? { objectsDropped } : {}),
      },
    }
  } catch (e) {
    const r = writeErrorResult<PromoteResult>(e)
    if (r.status === 413) {
      await removeMemberDocumentObjects([pending.blobPath]).catch(() => undefined)
      await deleteOwnedMemberDocumentUpload(ownerId, pending.id).catch(() => undefined)
    }
    return r
  }
}
