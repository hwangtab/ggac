import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { loadWorkStaff } from '@/lib/server/boardWorkAuth'
import { consumeWorkWrite } from '@/lib/server/boardWorkRateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { findPushSubscriptionOwner, upsertPushSubscription } from '@/db/queries/work/push'
import { subscribeBodySchema } from '@work/lib/push/subscription'
import { DAY_MS, PUSH_STALE_DAYS } from '@work/lib/ops/retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 푸시 구독 저장 — 원본 kosmart-work `/api/push/subscribe`(endpoint 유일 upsert).
 *
 * 권한:
 * 1. `requireBoardMember()` — 미로그인 401, 이사·감사·관리자가 아니면 403(업무툴 진입 게이트와 같은 판정).
 * 2. endpoint는 허용 목록(FCM·Mozilla·Apple·WNS)·https·공개 호스트만(SSRF — 서버가 이 주소로 POST한다).
 * 3. endpoint가 이미 **다른 사람** 것이면 409(남의 endpoint를 등록해 그 사람에게 갈 푸시를 가로채거나 끊는 것을 막는다).
 *    단 그 구독의 last_seen_at이 90일 넘게 지났으면 버려진 구독으로 보고 교체를 허용한다(원본과 같다).
 *    같은 기기에서 계정을 바꾼 경우는 클라이언트가 409를 받고 브라우저 구독을 새로 만들어 다시 저장한다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const staff = await loadWorkStaff(user.id)
      if (!staff) throw ApiError.forbidden('이사회 구성원(이사·감사)과 관리자만 쓸 수 있습니다.')
      const limited = await consumeWorkWrite(user.id)
      if (!limited.ok) throw ApiError.tooManyRequests(limited.message)

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const parsed = subscribeBodySchema.safeParse(body)
      if (!parsed.success) throw ApiError.badRequest('올바른 푸시 구독이 아닙니다.')
      const { endpoint, keys, userAgent } = parsed.data

      const existing = await findPushSubscriptionOwner(endpoint)
      if (existing && existing.userId !== user.id) {
        const staleBefore = Date.now() - PUSH_STALE_DAYS * DAY_MS
        if (existing.lastSeenAt.getTime() > staleBefore) {
          throw ApiError.conflict('이 기기 구독은 다른 계정에 등록돼 있습니다.')
        }
      }

      await upsertPushSubscription({
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? request.headers.get('user-agent')?.slice(0, 500) ?? null,
      })
      return ApiSuccess.ok({ ok: true })
    },
    '/api/board-room/work/push/subscribe',
    { userId: user.id, cacheControl: 'no-store' }
  )
}
