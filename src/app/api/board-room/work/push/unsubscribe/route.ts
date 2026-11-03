import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { deleteMyPushSubscription } from '@/db/queries/work/push'
import { unsubscribeBodySchema } from '@work/lib/push/subscription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 푸시 구독 해지 — 원본 kosmart-work `/api/push/unsubscribe`. **본인 구독만**(쿼리가 user_id = 로그인 사용자로 거른다 —
 * 남의 endpoint를 보내도 0행). `requireBoardMember()`를 먼저 부른다: 미로그인 401, 이사회 권한이 없으면 403.
 * 이사에서 빠진 사람의 구독은 발송 때 수신자 판정이 빼고, 90일 뒤 정리 크론이 지운다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const parsed = unsubscribeBodySchema.safeParse(body)
      if (!parsed.success) throw ApiError.badRequest('잘못된 요청입니다.')
      const removed = await deleteMyPushSubscription(user.id, parsed.data.endpoint)
      return ApiSuccess.ok({ ok: true, removed })
    },
    '/api/board-room/work/push/unsubscribe',
    { userId: user.id, cacheControl: 'no-store' }
  )
}
