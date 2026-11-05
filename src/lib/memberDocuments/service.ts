import { z } from 'zod'
import {
  addMemberDocumentVersion,
  deleteOwnedMemberDocumentUpload,
  getMemberDocumentUsage,
  getOwnedMemberDocument,
  getOwnedMemberDocumentUpload,
  getOwnedMemberDocumentVersion,
  insertMemberDocumentUpload,
  listOwnedDocumentUploadPaths,
  deleteOwnedMemberDocumentRow,
  MemberDocumentWriteError,
  type MemberDocumentPendingRow,
  type MemberDocumentVersionRow,
} from '@/db/queries/memberDocuments'
import { memberDocumentFilePath, isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import { removeRenderCachesWith } from '@work/lib/files/cleanup-plan'
import { resolveMime } from '@work/lib/files/mime'
import { displayFileName, sanitizeFileName } from '@work/lib/files/paths'
import { listObjectsPage, removeObjects } from '@work/lib/files/storage'
import { StorageUnconfiguredError } from '@work/lib/files/private-store'
import { StorageUnavailableError } from '@work/lib/files/storage-errors'
import {
  checkPromotable,
  decideUploadToken,
  PROMOTE_FAILURE_MESSAGE,
  type UploadTokenGrant,
} from '@work/lib/files/upload-rules'
import {
  FILE_TOO_LARGE_MESSAGE,
  isAllowedMemberDocument,
  isCompatibleVersionFile,
  MEMBER_DOCUMENT_MAX_FILE_BYTES,
  MEMBER_DOCUMENT_MAX_PENDING,
  MEMBER_DOCUMENT_NAME_MAX,
  normalizeRename,
  QUOTA_EXCEEDED_MESSAGE,
  quotaVerdict,
  renameWithExtension,
  UNSUPPORTED_TYPE_MESSAGE,
} from './rules'
import {
  copyMemberDocumentObject,
  hasMemberDocumentStore,
  removeMemberDocumentObjects,
  statMemberDocumentObject,
} from './storage'

/**
 * 조합원 내 문서함의 서버 단계(라우트가 게이트·스위치·레이트 리밋 **다음에** 부른다) — docs/board-work/04-조합원-문서함.md.
 * 권한 판정은 하지 않는다. 대신 모든 함수가 `ownerId`(라우트가 `requireActiveMember()`로 확정한 사용자 id)로만 행을 읽고
 * (쿼리 계층이 WHERE 에 넣는다), 객체 경로는 `isMemberDocumentPathOf(path, ownerId)`로 한 번 더 본다.
 *
 * 결과는 판별 유니온 대신 한 모양(strict: false 라 좁혀지지 않는다): `ok`가 거짓이면 `status`·`error`가 있다.
 */
export type ServiceResult<T> = { ok: boolean; data?: T; status?: number; error?: string }

export function fail<T>(status: number, error: string): ServiceResult<T> {
  return { ok: false, status, error }
}

export type PromoteResult = {
  documentId: string
  versionId: string
  versionNo: number
  name: string
  /** HWPX 개체가 줄었다(막지 않았다) — 표·그림·도형·수식 수 */
  objectsDropped?: { tables: number; pictures: number; shapes: number; equations: number }
}

/** 파일 하나를 올리는 데 필요한 조각 크기 경계(업무툴과 같다 — 넘으면 다중 조각 업로드) */
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024

const prepareSchema = z.object({
  type: z.literal('prepare'),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(MEMBER_DOCUMENT_MAX_FILE_BYTES),
  mime: z.string().max(200).optional().default(''),
  /** 새 버전으로 올리면 대상 문서 */
  documentId: z.string().uuid().optional(),
})

export type UploadTarget = { uploadId: string; pathname: string; mime: string; multipart: boolean }

export function writeErrorResult<T>(e: unknown): ServiceResult<T> {
  if (e instanceof MemberDocumentWriteError) {
    if (e.code === 'quota') return fail(413, QUOTA_EXCEEDED_MESSAGE)
    if (e.code === 'not_found') return fail(404, e.message)
    if (e.code === 'conflict') return fail(409, e.message)
    return fail(429, e.message)
  }
  throw e
}

/**
 * ① 업로드 준비: 형식·크기·대상 문서(내 것)·사용량을 보고 임시 업로드 행을 만든다. 객체 키는 서버가 정한다
 * (`member-documents/<나>/<업로드 id>/<안전 이름>`). 사용량은 쿼리가 같은 트랜잭션에서 다시 센다.
 */
export async function prepareMemberDocumentUpload(
  ownerId: string,
  body: unknown
): Promise<ServiceResult<UploadTarget>> {
  const parsed = prepareSchema.safeParse(body)
  if (!parsed.success) {
    const tooBig =
      typeof (body as { size?: unknown })?.size === 'number' &&
      (body as { size: number }).size > MEMBER_DOCUMENT_MAX_FILE_BYTES
    return fail(
      tooBig ? 413 : 400,
      tooBig ? FILE_TOO_LARGE_MESSAGE : '파일 정보가 올바르지 않습니다.'
    )
  }
  const { name: rawName, size, mime: rawMime, documentId } = parsed.data
  // 길이만 잘라 내면 긴 이름(정부 서식 HWP 등)의 확장자가 떨어져 415 로 거부됐다(2026-11-05 리뷰) — 확장자를 지키며 줄인다
  const display = displayFileName(rawName)
  const name = normalizeRename(display, display) ?? display.slice(0, MEMBER_DOCUMENT_NAME_MAX)
  if (!isAllowedMemberDocument(name)) return fail(415, UNSUPPORTED_TYPE_MESSAGE)

  if (documentId) {
    const doc = await getOwnedMemberDocument(ownerId, documentId)
    if (!doc) return fail(404, '문서를 찾을 수 없습니다.')
    if (!isCompatibleVersionFile(doc.document.name, name)) {
      return fail(415, '같은 형식의 파일만 새 버전으로 올릴 수 있습니다.')
    }
  }

  const usage = await getMemberDocumentUsage(ownerId)
  if (!quotaVerdict(usage.total, size).ok) return fail(413, QUOTA_EXCEEDED_MESSAGE)
  // 권한·용량을 본 뒤에 저장소 설정을 본다. 미설정이면 행을 만들지 않는다
  if (!hasMemberDocumentStore()) return fail(503, '파일 저장소가 설정되지 않았습니다.')

  const uploadId = crypto.randomUUID()
  const pathname = memberDocumentFilePath(ownerId, uploadId, sanitizeFileName(name))
  if (!pathname) return fail(400, '파일 정보가 올바르지 않습니다.')
  const mime = resolveMime(rawMime, name)
  try {
    await insertMemberDocumentUpload(
      {
        id: uploadId,
        ownerId,
        documentId: documentId ?? null,
        blobPath: pathname,
        name,
        mime,
        size,
      },
      { maxPending: MEMBER_DOCUMENT_MAX_PENDING }
    )
  } catch (e) {
    return writeErrorResult(e)
  }
  return {
    ok: true,
    data: { uploadId, pathname, mime, multipart: size > MULTIPART_THRESHOLD_BYTES },
  }
}

/**
 * ② 업로드 토큰 판정: 내 임시 업로드가 있고, pathname 이 그 행의 키와 같고, 지금도 용량 안일 때만. 업무툴과 같은
 * `decideUploadToken`(형식 하나·알린 크기까지)을 쓴다.
 */
export async function decideMemberDocumentToken(
  ownerId: string,
  uploadId: string,
  pathname: string
): Promise<ServiceResult<{ grant: UploadTokenGrant; blobPath: string }>> {
  const pending = await getOwnedMemberDocumentUpload(ownerId, uploadId)
  if (pending && !isMemberDocumentPathOf(pending.blobPath, ownerId)) {
    return fail(403, '업로드 경로가 일치하지 않습니다.')
  }
  let withinQuota = true
  if (pending) {
    const usage = await getMemberDocumentUsage(ownerId, new Date(), pending.id)
    withinQuota = quotaVerdict(usage.total, pending.size).ok
  }
  const decision = decideUploadToken({
    pathname,
    pending: pending
      ? { blobPath: pending.blobPath, mime: pending.mime, size: pending.size, draftMeta: null }
      : null,
    canPost: true,
    maxBytes: MEMBER_DOCUMENT_MAX_FILE_BYTES,
  })
  if (!decision.ok) return fail(decision.status ?? 403, decision.error ?? '업로드할 수 없습니다.')
  if (!withinQuota) return fail(413, QUOTA_EXCEEDED_MESSAGE)
  return { ok: true, data: { grant: decision.grant, blobPath: pending.blobPath } }
}

/** 실패·취소한 임시 업로드를 버린다(객체 → 행). 없거나 남의 것이면 404 */
export async function discardMemberDocumentUpload(
  ownerId: string,
  uploadId: string
): Promise<ServiceResult<null>> {
  const pending = await getOwnedMemberDocumentUpload(ownerId, uploadId)
  if (!pending) return fail(404, '업로드 정보를 찾을 수 없습니다.')
  if (isMemberDocumentPathOf(pending.blobPath, ownerId)) {
    try {
      await removeMemberDocumentObjects([pending.blobPath])
    } catch (e) {
      if (!(e instanceof StorageUnconfiguredError)) {
        return fail(503, '저장소가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.')
      }
    }
  }
  await deleteOwnedMemberDocumentUpload(ownerId, uploadId)
  return { ok: true, data: null }
}

/** 올린 객체를 확인한다(실제 크기·형식이 준비 때 알린 값과 같은가). 어긋나면 객체·행을 치운다 */
export async function confirmUploaded(
  ownerId: string,
  pending: MemberDocumentPendingRow
): Promise<ServiceResult<null>> {
  if (!isMemberDocumentPathOf(pending.blobPath, ownerId))
    return fail(404, '업로드 정보를 찾을 수 없습니다.')
  let stat: Awaited<ReturnType<typeof statMemberDocumentObject>>
  try {
    stat = await statMemberDocumentObject(pending.blobPath)
  } catch (e) {
    if (e instanceof StorageUnconfiguredError)
      return fail(503, '파일 저장소가 설정되지 않았습니다.')
    if (e instanceof StorageUnavailableError) {
      return fail(503, '저장소가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.')
    }
    throw e
  }
  const check = checkPromotable(pending, stat, MEMBER_DOCUMENT_MAX_FILE_BYTES)
  if (!check.ok) {
    if (check.reason !== 'incomplete') {
      await removeMemberDocumentObjects([pending.blobPath]).catch(() => undefined)
      await deleteOwnedMemberDocumentUpload(ownerId, pending.id).catch(() => undefined)
    }
    return fail(check.reason === 'incomplete' ? 409 : 422, PROMOTE_FAILURE_MESSAGE[check.reason])
  }
  return { ok: true, data: null }
}

/** 되돌리기 — 그 버전 객체를 새 키로 복사해 새 최신 버전으로(이전 버전들은 그대로). 용량을 다시 본다 */
export async function restoreVersion(
  ownerId: string,
  documentId: string,
  fromVersionId: string
): Promise<ServiceResult<PromoteResult>> {
  const found = await getOwnedMemberDocumentVersion(ownerId, fromVersionId)
  if (!found || found.document.id !== documentId) return fail(404, '버전을 찾을 수 없습니다.')
  const from: MemberDocumentVersionRow = found.version
  if (from.versionNo === found.document.latestVersionNo) {
    return fail(409, '이미 최신 버전입니다.')
  }
  const usage = await getMemberDocumentUsage(ownerId)
  if (!quotaVerdict(usage.total, from.size).ok) return fail(413, QUOTA_EXCEEDED_MESSAGE)
  if (!isMemberDocumentPathOf(from.blobPath, ownerId)) return fail(404, '버전을 찾을 수 없습니다.')

  const id = crypto.randomUUID()
  const to = memberDocumentFilePath(ownerId, id, sanitizeFileName(from.name))
  if (!to) return fail(400, '버전 정보가 올바르지 않습니다.')
  try {
    await copyMemberDocumentObject(from.blobPath, to)
  } catch (e) {
    if (e instanceof StorageUnconfiguredError)
      return fail(503, '파일 저장소가 설정되지 않았습니다.')
    return fail(503, '버전 파일을 복사하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  const name = renameWithExtension(found.document.name, from.name)
  try {
    const added = await addMemberDocumentVersion({
      ownerId,
      documentId,
      uploadId: null,
      baseVersionNo: null,
      version: { id, name, mime: from.mime, size: from.size, blobPath: to, source: 'restore' },
    })
    return {
      ok: true,
      data: { documentId, versionId: added.versionId, versionNo: added.versionNo, name },
    }
  } catch (e) {
    await removeMemberDocumentObjects([to]).catch(() => undefined)
    return writeErrorResult(e)
  }
}

/** 업무툴 렌더 캐시(`board-work/renders/<versionId>-…`) 정리 — 던지지 않는다 */
export function removeMemberDocumentRenderCaches(versionIds: readonly string[]): Promise<number> {
  return removeRenderCachesWith(versionIds, {
    listPage: listObjectsPage,
    remove: removeObjects,
    onError: (id, e) =>
      console.error('[member-documents] 미리보기 캐시 정리 실패', {
        id,
        error: e instanceof Error ? e.name : typeof e,
      }),
  })
}

/**
 * 문서 지우기 — 객체(모든 버전 + 이 문서로 올리던 임시 업로드)를 **먼저** 지우고, 성공했을 때만 행을 지운다(행을 먼저
 * 지우면 객체가 영영 남는다). 캐시는 그 뒤에 지운다(실패해도 응답을 막지 않는다).
 */
export async function deleteMemberDocument(
  ownerId: string,
  documentId: string
): Promise<ServiceResult<null>> {
  const doc = await getOwnedMemberDocument(ownerId, documentId)
  if (!doc) return fail(404, '문서를 찾을 수 없습니다.')
  const uploadPaths = await listOwnedDocumentUploadPaths(ownerId, documentId)
  const paths = [...doc.versions.map(v => v.blobPath), ...uploadPaths]
  if (paths.some(p => !isMemberDocumentPathOf(p, ownerId))) {
    console.error('[member-documents] 소유자 밖 경로를 가진 문서 — 지우지 않는다', { documentId })
    return fail(500, '문서를 지우지 못했습니다.')
  }
  try {
    await removeMemberDocumentObjects(paths)
  } catch (e) {
    if (!(e instanceof StorageUnconfiguredError)) {
      return fail(503, '저장소가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.')
    }
    // 저장소가 없는 배포(시험)에는 지울 객체도 없다 — 행만 지운다
  }
  await deleteOwnedMemberDocumentRow(ownerId, documentId)
  await removeMemberDocumentRenderCaches(doc.versions.map(v => v.id)).catch(() => 0)
  return { ok: true, data: null }
}

/** 화면에 내보내는 버전 — 객체 키는 싣지 않는다 */
export function versionView(v: MemberDocumentVersionRow) {
  return {
    id: v.id,
    versionNo: v.versionNo,
    name: v.name,
    mime: v.mime,
    size: v.size,
    source: v.source,
    createdAt: v.createdAt.toISOString(),
  }
}
