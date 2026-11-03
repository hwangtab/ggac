import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { isMyPushSubscription } from '@/db/queries/work/push'
import { unsubscribeBodySchema } from '@work/lib/push/subscription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 이 브라우저 구독(endpoint)이 "내 것"으로 서버에 등록돼 있는가 — 원본 kosmart-work `/api/push/status`.
 * 설정 화면이 브라우저 구독이 있다는 이유만으로 "켜짐"을 보이지 않게 한다(같은 기기를 쓴 이전 사용자의 구독이 남은 경우 false).
 * 남의 endpoint인지 아닌지는 알리지 않는다 — 내 것이 아니면 모두 false다. `requireBoardMember()`가 먼저다.
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
      return ApiSuccess.ok({ mine: await isMyPushSubscription(user.id, parsed.data.endpoint) })
    },
    '/api/board-room/work/push/status',
    { userId: user.id, cacheControl: 'no-store' }
  )
}
