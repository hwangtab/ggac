import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { boardDocumentEditStoreToken } from '@/lib/boardDocuments/storage'
import {
  decideBoardDocumentUploadToken,
  prepareBoardDocumentUpload,
} from '@/lib/boardDocuments/uploadRules'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { limitBoardDocumentEdit } from '@/lib/server/boardDocumentEditRoute'
import { rateLimit } from '@/lib/server/rateLimit'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 토큰 유효 시간 — 50MB 가 느린 회선에서도 끝날 만큼(앱 편집 저장본·문서함과 같다) */
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
    clientPayload: z.string().max(512).nullable().optional(),
  }),
})

/**
 * POST /api/board-room/documents/uploads — 이사회 서류의 **브라우저 직접 업로드**(서류함·정기총회·자료실).
 *
 * Vercel 함수는 요청 본문 4.5MB 를 넘으면 플랫폼 413 으로 끊어, multipart 로 함수에 보내던 예전 방식은 스캔한 회의록처럼
 * 큰 파일을 올리지 못했다. 이제 파일 바이트는 함수를 지나지 않는다(앱 편집 저장본 `/[id]/edit-uploads`와 같은 두 단계):
 *  1. `{ type: 'prepare', name, size, mime }` → 50MB·허용 형식을 보고 서버가 키를 정해 돌려준다
 *     (`board-documents/<내 id>/<시각>_<무작위>_<안전 이름>`, 큰 파일은 `multipart`).
 *  2. `{ type: 'blob.generate-client-token', payload: { pathname, … } }` → `@vercel/blob/client` `upload()`의 요청.
 *     pathname 이 **내 폴더**(`board-documents/<내 id>/<파일>`)이고 봉쇄 판정·허용 확장자를 지날 때만 토큰을 준다
 *     (허용 형식·50MB 까지, 덮어쓰기·무작위 접미사 없이).
 * 서류 행은 만들지 않는다 — 등록은 `/api/board-room/documents` POST(JSON 분기)가 객체를 다시 확인한 뒤 한다.
 *
 * 게이트: requireBoardMember(비로그인 401·조합원·미승인 403) → 레이트 리밋(준비는 기존 서류 올리기와 같은
 * `FILE_UPLOAD` — 올리기 한 번에 한 번만 센다. 토큰은 사용자 단위 쓰기 한도) → 판정.
 * **kordoc 을 부르는 모듈을 import 하지 않는다**(next.config.js `KORDOC_ROUTES`에 넣지 않는다).
 */
export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const userId = auth.user.id

  try {
    const body = await parseJsonObjectBody(request)
    if (!body) return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()

    if (body.type === 'prepare') {
      const rl = await rateLimit(request, 'FILE_UPLOAD')
      if (!rl.success) {
        return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
      }
      const prepared = prepareBoardDocumentUpload(userId, body, {
        now: Date.now(),
        random: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      })
      if (prepared.ok === false) {
        return new ApiError(prepared.error, prepared.status).toNextResponse()
      }
      if (!boardDocumentEditStoreToken()) {
        return ApiError.serviceUnavailable('파일 저장소가 설정되지 않았습니다.').toNextResponse()
      }
      return ApiSuccess.ok({ target: prepared.data }).toNextResponse()
    }

    const limited = await limitBoardDocumentEdit(userId)
    if (limited) return limited

    const parsed = tokenEventSchema.safeParse(body)
    if (!parsed.success) return ApiError.badRequest('잘못된 업로드 요청입니다.').toNextResponse()
    const { pathname } = parsed.data.payload
    const decision = decideBoardDocumentUploadToken(userId, pathname)
    if (decision.ok === false) {
      return new ApiError(decision.error, decision.status).toNextResponse()
    }

    const token = boardDocumentEditStoreToken()
    if (!token) {
      return ApiError.serviceUnavailable('파일 저장소가 설정되지 않았습니다.').toNextResponse()
    }

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
          tokenPayload: userId,
        }
      },
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    if (e instanceof UploadDenied) return new ApiError(e.message, e.status).toNextResponse()
    console.error('[board-documents/uploads] 처리 실패:', e instanceof Error ? e.name : typeof e)
    return ApiError.internalServerError(
      '업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    ).toNextResponse()
  }
}
