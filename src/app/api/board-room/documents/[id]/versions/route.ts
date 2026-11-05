import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getBoardDocumentForEdit,
  listBoardDocumentVersions,
  type BoardDocumentEditRow,
} from '@/db/queries/boardDocumentVersions'
import { getDisplayNames } from '@/db/queries/work/directory'
import { canEditBoardDocument, editorSourceFor, hasWebBody } from '@/lib/boardDocuments/editRules'
import {
  currentFileName,
  recordBoardDocumentEdit,
  revertToVersion,
  saveEditedVersion,
} from '@/lib/boardDocuments/versions'
import { requireBoardMember, visibilityScopeFor } from '@/lib/server/boardRoomAuth'
import {
  boardDocumentNotFound,
  editableBoardDocumentOr,
  isUuid,
  limitBoardDocumentEdit,
} from '@/lib/server/boardDocumentEditRoute'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { canOfferAppEdit } from '@work/lib/files/app-edit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// HWP·HWPX 저장본: 원본·저장본 읽기 + kordoc 두 번 읽기 + 쪽 수 비교, 웹 본문 다시 만들기
export const maxDuration = 60

function downloadUrl(documentId: string, versionId: string | null, isLatest: boolean): string {
  return isLatest || !versionId
    ? `/api/board-room/documents/${documentId}/download`
    : `/api/board-room/documents/${documentId}/versions/${versionId}/download`
}

/**
 * GET /api/board-room/documents/<서류 id>/versions — 서류의 버전 기록(최신 먼저)과 지금 사람이 고칠 수 있는지
 * (docs/board-work/05-이사회-서류-앱-편집.md §4). 한 번도 고치지 않은 서류는 행이 없으므로 지금 파일을 v1 한 줄로 보인다.
 * 경로·본문은 싣지 않는다(내려받기는 매 요청 권한을 다시 보는 내부 경로).
 *
 * 게이트: requireBoardMember — **조합원(열람 게이트로 조합원 공개 서류를 보는 사람)은 403** 이다. 지나간 버전·편집
 * 이력은 이사회 안의 기록이다. 서류가 없거나 이사회에도 보이지 않는 등급이면 404.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!isUuid(id)) return boardDocumentNotFound()

  let doc: BoardDocumentEditRow | null
  try {
    doc = await getBoardDocumentForEdit(id)
  } catch {
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }
  if (!doc || !visibilityScopeFor(true).includes(doc.visibility)) return boardDocumentNotFound()

  try {
    const rows = await listBoardDocumentVersions(doc.id)
    const name = currentFileName(doc)
    let versions
    if (rows.length === 0) {
      const names = await getDisplayNames(doc.uploadedBy ? [doc.uploadedBy] : [])
      versions = [
        {
          id: null,
          versionNo: 1,
          fileName: name,
          fileSize: doc.fileSize ?? 0,
          source: 'upload',
          createdByName: doc.uploadedBy ? (names.get(doc.uploadedBy) ?? null) : null,
          createdAt: doc.createdAt.toISOString(),
          isLatest: true,
          downloadUrl: downloadUrl(doc.id, null, true),
        },
      ]
    } else {
      const latestNo = rows[0].versionNo
      versions = rows.map(v => ({
        id: v.id,
        versionNo: v.versionNo,
        fileName: v.fileName,
        fileSize: v.fileSize,
        source: v.source,
        createdByName: v.createdByName,
        createdAt: v.createdAt.toISOString(),
        isLatest: v.versionNo === latestNo,
        downloadUrl: downloadUrl(doc.id, v.id, v.versionNo === latestNo),
      }))
    }
    return ApiSuccess.ok({
      document: {
        id: doc.id,
        title: doc.title,
        category: doc.category,
        fileName: name,
        fileSize: doc.fileSize ?? 0,
        mimeType: doc.mimeType,
        visibility: doc.visibility,
        hasBody: hasWebBody(doc.bodyMarkdown),
        latestVersionNo: versions[0].versionNo,
        canEdit: canEditBoardDocument({
          uploadedBy: doc.uploadedBy,
          userId: auth.user.id,
          isAdmin: auth.isAdmin,
        }),
        editableHere: canOfferAppEdit(name, doc.fileSize ?? 0),
      },
      versions,
    }).toNextResponse()
  } catch (e) {
    console.error('[board-documents/versions] 목록 실패:', e instanceof Error ? e.name : typeof e)
    return ApiError.internalServerError('버전 기록을 불러올 수 없습니다.').toNextResponse()
  }
}

const bodySchema = z.union([
  z.object({
    uploadId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    baseVersionNo: z.number().int().min(1).nullable().optional(),
  }),
  z.object({ revertVersionId: z.string().uuid() }),
])

/**
 * POST /api/board-room/documents/<서류 id>/versions — 새 버전(05 §4·§5).
 *   `{ uploadId, name, baseVersionNo? }` 편집기 저장본(`/edit-uploads`로 올린 것)을 새 최신 버전으로. 오피스는 OOXML 머리,
 *     HWP·HWPX 는 원본과 비교 검사를 지나야 한다(막히면 422, 객체를 치운다). `baseVersionNo`가 최신이 아니면 409.
 *   `{ revertVersionId }` 그 버전을 복사해 새 최신 버전으로(되돌리기 — 지나간 기록은 고치지 않는다).
 * 처음 저장이면 지금 파일을 v1 행으로 옮긴다. 저장 뒤: 검색 본문 다시 뽑기·미리보기 캐시 지우기·웹 본문(있던 서류만)
 * 다시 만들기·활동 기록(내용 없이).
 * 게이트: requireBoardMember → 경로 id(404) → 쓰기 레이트 리밋(저장은 검사 한도도) → 서류(404)·편집 권한(403).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!isUuid(id)) return boardDocumentNotFound()
  const limited = await limitBoardDocumentEdit(auth.user.id)
  if (limited) return limited
  const doc = await editableBoardDocumentOr(id, auth.user.id, auth.isAdmin)
  if (doc instanceof NextResponse) return doc

  const parsed = bodySchema.safeParse(await parseJsonObjectBody(request))
  if (!parsed.success) return ApiError.badRequest('요청 내용을 확인해 주세요.').toNextResponse()
  const body = parsed.data as {
    uploadId?: string
    name?: string
    baseVersionNo?: number | null
    revertVersionId?: string
  }

  try {
    if (body.revertVersionId) {
      const reverted = await revertToVersion(doc, auth.user.id, body.revertVersionId)
      if (!reverted.ok) return new ApiError(reverted.error, reverted.status).toNextResponse()
      await recordBoardDocumentEdit(request, {
        userId: auth.user.id,
        isAdmin: auth.isAdmin,
        action: 'board_document_version_reverted',
        documentId: doc.id,
        versionNo: reverted.data.versionNo,
        source: 'revert',
        fromVersionNo: reverted.data.fromVersionNo,
      })
      return ApiSuccess.created(
        reverted.data,
        `v${reverted.data.fromVersionNo}을 복사해 v${reverted.data.versionNo}으로 저장했습니다.`
      ).toNextResponse()
    }

    const verifyLimited = await limitBoardDocumentEdit(auth.user.id, 'verify')
    if (verifyLimited) return verifyLimited
    const saved = await saveEditedVersion(doc, auth.user.id, {
      uploadId: body.uploadId,
      name: body.name,
      baseVersionNo: body.baseVersionNo ?? null,
    })
    if (!saved.ok) return new ApiError(saved.error, saved.status).toNextResponse()
    await recordBoardDocumentEdit(request, {
      userId: auth.user.id,
      isAdmin: auth.isAdmin,
      action: 'board_document_version_saved',
      documentId: doc.id,
      versionNo: saved.data.versionNo,
      source: editorSourceFor(currentFileName(doc)) ?? 'office-editor',
    })
    return ApiSuccess.created(
      saved.data,
      `v${saved.data.versionNo}으로 저장했습니다.`
    ).toNextResponse()
  } catch (e) {
    // 문서 내용이 섞일 수 있어 메시지는 남기지 않는다
    console.error('[board-documents/versions] 실패:', e instanceof Error ? e.name : typeof e)
    return ApiError.internalServerError('새 버전을 저장하지 못했습니다.').toNextResponse()
  }
}
