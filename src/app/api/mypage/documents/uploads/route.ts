import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  decideMemberDocumentToken,
  prepareMemberDocumentUpload,
} from '@/lib/memberDocuments/service'
import { memberDocumentStoreToken } from '@/lib/memberDocuments/storage'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { limitMemberDocumentWrite, memberDocumentsOff } from '@/lib/server/memberDocumentsRoute'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 토큰 유효 시간 — 50MB 파일이 느린 회선에서도 끝날 만큼 */
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
 * POST /api/mypage/documents/uploads — 내 문서함 파일의 **브라우저 직접 업로드**(업무툴 `/api/board-room/work/uploads`와
 * 같은 두 단계, docs/board-work/04-조합원-문서함.md §4·§5).
 *  1. `{ type: 'prepare', name, size, mime, documentId? }` → 형식·크기(50MB)·대상 문서(내 것)·사용량(200MB)을 보고
 *     서버가 키(`member-documents/<나>/<uploadId>/<안전 이름>`)를 정해 임시 업로드 행을 만든다.
 *  2. `{ type: 'blob.generate-client-token', payload: { pathname, multipart, clientPayload: <uploadId> } }`
 *     → `@vercel/blob/client` `upload()`의 요청. **내 임시 업로드가 있고, pathname 이 그 키와 같고, 지금도 용량 안일 때만**
 *     토큰을 준다(형식 하나·알린 크기까지, 덮어쓰기·무작위 접미사 없이). 응답은 SDK 규약 그대로.
 * 게이트: requireActiveMember → 스위치(503) → 쓰기 레이트 리밋. 토큰은 `handleUpload({ token })`에 명시한다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off
  const limited = await limitMemberDocumentWrite(auth.user.id)
  if (limited) return limited
  const ownerId = auth.user.id

  try {
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    if (body.type === 'prepare') {
      const prepared = await prepareMemberDocumentUpload(ownerId, body)
      if (!prepared.ok) return new ApiError(prepared.error, prepared.status).toNextResponse()
      return ApiSuccess.ok({ target: prepared.data }).toNextResponse()
    }

    const parsed = tokenEventSchema.safeParse(body)
    if (!parsed.success) return ApiError.badRequest('잘못된 업로드 요청입니다.').toNextResponse()
    const { pathname, clientPayload: uploadId } = parsed.data.payload

    const decision = await decideMemberDocumentToken(ownerId, uploadId, pathname)
    if (!decision.ok) return new ApiError(decision.error, decision.status).toNextResponse()

    const token = memberDocumentStoreToken()
    if (!token)
      return ApiError.serviceUnavailable('파일 저장소가 설정되지 않았습니다.').toNextResponse()

    const { grant, blobPath } = decision.data
    const result = await handleUpload({
      token,
      request,
      body: parsed.data as HandleUploadBody,
      onBeforeGenerateToken: async requestedPath => {
        if (requestedPath !== blobPath) {
          throw new UploadDenied(403, '업로드 경로가 일치하지 않습니다.')
        }
        return {
          allowedContentTypes: grant.allowedContentTypes,
          maximumSizeInBytes: grant.maximumSizeInBytes,
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
    console.error('[member-documents/uploads] 처리 실패:', e instanceof Error ? e.name : typeof e)
    return ApiError.internalServerError(
      '업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    ).toNextResponse()
  }
}
