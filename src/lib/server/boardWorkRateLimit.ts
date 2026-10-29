import { NextRequest } from 'next/server'
import { applyRateLimit, RATE_LIMITS } from '@/lib/server/rateLimit'

/**
 * 이사회 업무툴 레이트 리밋 — 설계 §6-3. 키는 **사용자 id**다: 게이트(`requireWorkStaff`·`requireBoardMember`)를
 * 지난 뒤에만 부르므로 신원이 확정돼 있고, 같은 사무실(같은 IP)의 이사 여럿이 한 버킷을 나눠 쓰지 않게 한다.
 *
 * server action에는 NextRequest가 없다. 리미터는 요청에서 메서드(장애 시 쓰기는 fail-closed)와 URL(로그)만 읽으므로
 * 쓰기 action은 내부 표식 요청(POST)을 만들어 넘긴다.
 */
const ACTION_REQUEST_URL = 'https://board-work.internal/server-action'

/** strict: false라 판별 유니온 대신 한 모양으로 둔다 */
export type WorkRateLimitResult = { ok: boolean; message?: string }

async function consume(
  config: (typeof RATE_LIMITS)['WORK_WRITE'] | (typeof RATE_LIMITS)['WORK_SYNC'],
  userId: string,
  request?: NextRequest
): Promise<WorkRateLimitResult> {
  const limiter = await applyRateLimit({
    ...config,
    keyGenerator: () => `rate_limit:${config.name}:${userId}`,
  })
  const result = await limiter(request ?? new NextRequest(ACTION_REQUEST_URL, { method: 'POST' }))
  return result.success ? { ok: true } : { ok: false, message: config.message }
}

/** 쓰기 server action(WORK_WRITE, 분당 60) */
export function consumeWorkWrite(userId: string): Promise<WorkRateLimitResult> {
  return consume(RATE_LIMITS.WORK_WRITE, userId)
}

/** 폴링 라우트(WORK_SYNC, 분당 60) */
export function consumeWorkSync(
  userId: string,
  request: NextRequest
): Promise<WorkRateLimitResult> {
  return consume(RATE_LIMITS.WORK_SYNC, userId, request)
}
