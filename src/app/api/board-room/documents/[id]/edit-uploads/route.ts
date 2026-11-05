import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { boardDocumentEditStoreToken } from '@/lib/boardDocuments/storage'
import { decideEditUploadToken, prepareEditUpload } from '@/lib/boardDocuments/editUploads'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import {
  boardDocumentNotFound,
  editableBoardDocumentOr,
  isUuid,
  limitBoardDocumentEdit,
} from '@/lib/server/boardDocumentEditRoute'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 토큰 유효 시간 — 50MB 저장본이 느린 회선에서도 끝날 만큼(문서함과 같다) */
const TOKEN_TTL_MS = 60 * 60 * 1000

class UploadDenied extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'UploadDenied'
  }
}

const tokenEventSchema = z.object({
  type: z.literal('blob.generate-client-token'),
  payload: z.object({
    pathname: z.string().min(1).max(512),
    multipart: z.boolean(),
    clientPayload: z.string().uuid(),
  }),
})

/**
 * POST /api/board-room/documents/<서류 id>/edit-uploads — 앱 편집기 저장본의 **브라우저 직접 업로드**
 * (docs/board-work/05-이사회-서류-앱-편집.md §3·§4 — 내 문서함 `/api/mypage/documents/uploads`와 같은 두 단계).
 *  1. `{ type: 'prepare', name, size }` → 이 배포에서 앱 편집할 수 있는 서류인지·저장본이 같은 형식·상한 안인지 보고
 *     서버가 키(`board-documents/versions/<서류>/<업로드 id>/<안전 이름>`)를 정해 돌려준다.
 *  2. `{ type: 'blob.generate-client-token', payload: { pathname, multipart, clientPayload: <업로드 id> } }` →
 *     `@vercel/blob/client` `upload()`의 요청. pathname 이 **이 서류의 버전 키**이고 업로드 id 구간이 같을 때만
 *     토큰을 준다(형식 하나·편집기 상한까지, 덮어쓰기·무작위 접미사 없이).
 * 게이트: requireBoardMember(비로그인 401·조합원 403) → 경로 id(404) → 쓰기 레이트 리밋 → 서류(없음 404)·편집 권한
 * (올린 사람·관리자가 아니면 403). 저장본을 새 버전으로 만드는 일은 `/versions` POST 가 한다.
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

  try {
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    if (body.type === 'prepare') {
      const prepared = prepareEditUpload(doc, body)
      if (!prepared.ok) return new ApiError(prepared.error, prepared.status).toNextResponse()
      return ApiSuccess.ok({ target: prepared.data }).toNextResponse()
    }

    const parsed = tokenEventSchema.safeParse(body)
    if (!parsed.success) return ApiError.badRequest('잘못된 업로드 요청입니다.').toNextResponse()
    const { pathname, clientPayload: uploadId } = parsed.data.payload
    const decision = decideEditUploadToken(doc, uploadId, pathname)
    if (!decision.ok) return new ApiError(decision.error, decision.status).toNextResponse()

    const token = boardDocumentEditStoreToken()
    if (!token)
      return ApiError.serviceUnavailable('파일 저장소가 설정되지 않았습니다.').toNextResponse()

    const result = await handleUpload({
      token,
      request,
      body: parsed.data as HandleUploadBody,
      onBeforeGenerateToken: async requestedPath => {
        if (requestedPath !== pathname) {
          throw new UploadDenied(403, '업로드 경로가 일치하지 않습니다.')
        }
        return {
          allowedContentTypes: decision.data.allowedContentTypes,
          maximumSizeInBytes: decision.data.maximumSizeInBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + TOKEN_TTL_MS,
          tokenPayload: uploadId,
        }
      },
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    if (e instanceof UploadDenied) return new ApiError(e.message, e.status).toNextResponse()
    console.error(
      '[board-documents/edit-uploads] 처리 실패:',
      e instanceof Error ? e.name : typeof e
    )
    return ApiError.internalServerError(
      '업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    ).toNextResponse()
  }
}
