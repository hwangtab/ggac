import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { getPendingUpload } from '@/db/queries/work/files'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { loadWorkStaff } from '@/lib/server/boardWorkAuth'
import { loadChannelAccess, type WorkViewer } from '@/lib/server/boardWorkChannelAuth'
import { consumeWorkWrite } from '@/lib/server/boardWorkRateLimit'
import { MAX_FILE_BYTES } from '@work/lib/files/schema'
import { boardWorkBlobToken } from '@work/lib/files/storage'
import { decideUploadToken, prepareUploads } from '@work/lib/files/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 토큰 유효 시간 — 대용량 다중 조각 업로드가 끝날 만큼(원본 서명 업로드 URL 2시간) */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000

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

function deny(status: number, message: string): NextResponse {
  return new ApiError(message, status).toNextResponse()
}

/**
 * POST /api/board-room/work/uploads — 이사회 업무툴 첨부의 **브라우저 직접 업로드**(설계 §7-2). 원본 kosmart-work
 * `createUploadTargets`(서명 업로드 URL 발급)·`renewUploadTarget` 자리를 Vercel Blob 클라이언트 업로드로 다시 썼다.
 *
 * 본문 `type`으로 두 단계를 가른다(같은 게이트 — requireBoardMember → 업무툴 역할 → 쓰기 레이트 리밋):
 *  1. `{ type: 'prepare', channelId, files: [{ name, size, mime }] }`
 *     → 채널 **멤버**만(보관 채널 제외). 파일마다 서버가 키(`board-work/files/<uploadId>/<안전 이름>`)·형식을 정하고
 *       `work_pending_uploads` 행을 만든다(사용자당 100개 상한). 응답 `{ success, data: { targets } }`.
 *  2. `{ type: 'blob.generate-client-token', payload: { pathname, multipart, clientPayload: <uploadId> } }`
 *     → `@vercel/blob/client` `upload()`가 보내는 요청. **본인의 임시 업로드 행이 있고, pathname 이 그 행의 키와 같고,
 *       지금도 그 채널 멤버일 때만** 토큰을 준다. 토큰은 그 행의 형식 하나·알린 크기까지, 덮어쓰기·무작위 접미사 없이.
 *       응답은 SDK 규약 그대로(`{ type, clientToken }` — ApiSuccess 로 감싸지 않는다. 감싸면 SDK 가 읽지 못한다).
 * `blob.upload-completed` 콜백은 받지 않는다 — 완료는 브라우저가 알리고 서버가 `head()`로 확인해 승격한다(attachUploads).
 * 토큰은 `handleUpload({ token })`에 **명시**한다 — 빠지면 SDK 가 `BLOB_READ_WRITE_TOKEN`으로 떨어진다(§7-5).
 */
export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  try {
    const staff = await loadWorkStaff(user.id)
    if (!staff) return deny(403, '이사회 구성원(이사·감사)과 관리자만 쓸 수 있습니다.')
    const viewer: WorkViewer = { userId: user.id, role: staff.role }

    const body = await parseJsonObjectBody(request)
    if (!body) return deny(400, '유효한 JSON body가 필요합니다.')

    if (body.type === 'prepare') {
      const limited = await consumeWorkWrite(user.id)
      if (!limited.ok) return deny(429, limited.message ?? '요청이 너무 많습니다.')
      const result = await prepareUploads(viewer, body, {
        storeReady: boardWorkBlobToken() !== null,
      })
      if (!result.ok) return deny(result.status ?? 400, result.error)
      return ApiSuccess.ok({ targets: result.data }).toNextResponse()
    }

    const parsed = tokenEventSchema.safeParse(body)
    if (!parsed.success) return deny(400, '잘못된 업로드 요청입니다.')
    const { pathname, clientPayload: uploadId } = parsed.data.payload

    const pending = await getPendingUpload(uploadId, user.id)
    const access = pending ? await loadChannelAccess(viewer, pending.channelId) : null
    const decision = decideUploadToken({
      pathname,
      pending,
      canPost: Boolean(access?.isMember && !access.archived),
      maxBytes: MAX_FILE_BYTES,
    })
    if (!decision.ok) return deny(decision.status, decision.error)

    const token = boardWorkBlobToken()
    if (!token) return deny(503, '파일 저장소가 설정되지 않았습니다.')

    const grant = decision.grant
    const result = await handleUpload({
      token,
      request,
      body: parsed.data as HandleUploadBody,
      onBeforeGenerateToken: async requestedPath => {
        // handleUpload 가 넘기는 pathname 은 위에서 검사한 값과 같다 — 한 번 더 맞춰 본다
        if (requestedPath !== pending.blobPath)
          throw new UploadDenied(403, '업로드 경로가 일치하지 않습니다.')
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
    if (e instanceof UploadDenied) return deny(e.status, e.message)
    console.error('[board-work/uploads] 처리 실패:', e)
    return deny(500, '업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
