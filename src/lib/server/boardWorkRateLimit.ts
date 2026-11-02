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
  config:
    | (typeof RATE_LIMITS)['WORK_WRITE']
    | (typeof RATE_LIMITS)['WORK_SYNC']
    | (typeof RATE_LIMITS)['WORK_RENDER']
    | (typeof RATE_LIMITS)['WORK_RENDER_THUMB']
    | (typeof RATE_LIMITS)['WORK_DOC_EDIT_READ']
    | (typeof RATE_LIMITS)['WORK_DOC_EDIT_DRAFT'],
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

/**
 * 문서 미리보기 변환(WORK_RENDER 분당 20 / 썸네일 WORK_RENDER_THUMB 분당 30) — 캐시가 없어 kordoc 이 실제로 돌 때만 센다.
 * 원본 render-guard의 프로세스 메모리 리미터 자리. 리미터 장애 때 GET 은 fail-open(읽기 기본값)이다.
 */
export function consumeWorkRender(
  userId: string,
  purpose: 'view' | 'thumb'
): Promise<WorkRateLimitResult> {
  return consume(
    purpose === 'thumb' ? RATE_LIMITS.WORK_RENDER_THUMB : RATE_LIMITS.WORK_RENDER,
    userId,
    new NextRequest('https://board-work.internal/render', { method: 'GET' })
  )
}

/**
 * 문서 편집(HWP 양식 채우기·문구 고치기·편집기 저장본 검증) — 읽기(WORK_DOC_EDIT_READ 분당 20)와 초안·검증
 * (WORK_DOC_EDIT_DRAFT 분당 10). 원본 doc-edit-route의 프로세스 메모리 리미터 자리. 초안은 쓰기라 장애 때 fail-closed 다.
 */
export function consumeWorkDocEdit(
  userId: string,
  kind: 'read' | 'draft'
): Promise<WorkRateLimitResult> {
  return consume(
    kind === 'draft' ? RATE_LIMITS.WORK_DOC_EDIT_DRAFT : RATE_LIMITS.WORK_DOC_EDIT_READ,
    userId,
    new NextRequest('https://board-work.internal/doc-edit', {
      method: kind === 'draft' ? 'POST' : 'GET',
    })
  )
}
