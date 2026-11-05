import {
  getOwnedMemberDocumentVersion,
  addMemberDocumentVersion,
  createMemberDocumentFromUpload,
  deleteOwnedMemberDocumentUpload,
  getOwnedMemberDocument,
  getOwnedMemberDocumentUpload,
  type MemberDocumentPendingRow,
} from '@/db/queries/memberDocuments'
import { isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import { type ObjectsDropped } from '@work/lib/files/doc-edit-types'
import { inspectEditorSave } from '@work/lib/files/editor-save-inspect'
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
 * docs/board-work/04-조합원-문서함.md §9. 저장본 검사 판정(`inspectEditorSave`)은 이사회 서류 앱 편집과 함께 쓰려고
 * `src/work/lib/files/editor-save-inspect.ts`로 옮겼다(동작은 같다 — 05 §5).
 */

/** 저장본 검사가 필요한 승격인가(편집기에서 저장한 HWP·HWPX) */
function editorFormatOf(source: MemberDocumentSource, name: string): 'hwp' | 'hwpx' | null {
  return source === 'editor' ? hwpEditFormatOf(name) : null
}

async function readBounded(path: string, max: number): Promise<Buffer | null> {
  const bytes = await downloadMemberDocumentObject(path)
  return bytes.length > max ? null : bytes
}

/**
 * 승격하지 못한 임시 업로드를 치운다 — **행을 먼저 지우고, 실제로 지웠을 때만 객체를 지운다.** 같은 업로드를 다른 요청이
 * 그 사이 승격했으면(승격 트랜잭션이 임시 행을 지운다) 행이 없어 그 객체(= 새 버전 파일)를 건드리지 않는다. 그대로 두면
 * 임시 업로드가 24시간 동안 200MB 용량을 차지해, 몇 번 실패하면 하루 동안 올리기가 전부 413 이었다(2026-11-05 리뷰).
 */
async function discardPendingUpload(ownerId: string, pending: MemberDocumentPendingRow) {
  const removed = await deleteOwnedMemberDocumentUpload(ownerId, pending.id).catch(() => null)
  if (!removed) return
  await removeMemberDocumentObjects([pending.blobPath]).catch(() => undefined)
}

async function blockedSave<T>(ownerId: string, pending: MemberDocumentPendingRow, reason: string) {
  await discardPendingUpload(ownerId, pending)
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
  if (!pending || pending.documentId !== null) {
    // 같은 업로드로 이미 만든 문서면 그 결과를 돌려준다 — 첫 요청이 커밋된 뒤 응답만 끊겨 화면이 다시 보낸 경우다(새 문서 v1 의
    // 버전 id 가 업로드 id 다). 예전에는 404 였고, 화면은 실패로 알고 다시 저장해 문서가 둘 생겼다(2026-11-05 점검).
    const made = !pending
      ? await getOwnedMemberDocumentVersion(ownerId, input.uploadId).catch(() => null)
      : null
    if (made && made.version.versionNo === 1) {
      return {
        ok: true,
        data: {
          documentId: made.document.id,
          versionId: made.version.id,
          versionNo: 1,
          name: made.version.name,
        },
      }
    }
    return fail(404, '올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
  }
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
    // 다시 시도해도 같은 업로드로는 저장되지 않는 실패(용량·개수·충돌·없음)면 임시 업로드를 치운다. 저장소 장애(5xx)는 남긴다.
    if (r.status === 413 || r.status === 409 || r.status === 429 || r.status === 404) {
      await discardPendingUpload(ownerId, pending)
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
    // 다른 탭이 먼저 저장했다 — 이 업로드로는 저장하지 않으니 치운다(다시 저장하면 새로 올린다)
    await discardPendingUpload(ownerId, pending)
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
      original: { bytes: original, cacheKey: base.id, name: base.name },
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
    // 다시 시도해도 같은 업로드로는 저장되지 않는 실패(용량·개수·충돌·없음)면 임시 업로드를 치운다. 저장소 장애(5xx)는 남긴다.
    if (r.status === 413 || r.status === 409 || r.status === 429 || r.status === 404) {
      await discardPendingUpload(ownerId, pending)
    }
    return r
  }
}
