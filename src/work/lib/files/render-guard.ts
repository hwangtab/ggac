import { consumeWorkRender } from '@/lib/server/boardWorkRateLimit'
import type { RenderErrorCode } from './render-types'

/**
 * 문서 변환 라우트 보호(원본 보고서 S-6). 캐시 적중(저장된 변환 결과)은 값싸므로 제한하지 않는다 — 변환이 실제로 도는
 * 요청만 센다.
 *
 * ggac 이식: 원본은 사용자당 분당 횟수를 **프로세스 메모리**(FixedWindowLimiter)로 셌다 — 서버리스 인스턴스마다 따로라
 * 느슨했다. 여기서는 ggac 분산 리미터(`WORK_RENDER`·`WORK_RENDER_THUMB`, Upstash)로 센다. 같은 파일의 결정적 실패
 * 기억은 그대로 프로세스 메모리다(값이 틀려도 다시 변환할 뿐이라 정확할 필요가 없다).
 */

/** 사용자당 분당 변환 횟수(분산 리미터 WORK_RENDER와 같은 값) */
export const RENDER_RATE_LIMIT_PER_MIN = 20
/**
 * 파일 상세 썸네일(`?purpose=thumb`)이 쓰는 몫 — 미리보기와 따로 센다(WORK_RENDER_THUMB). 자료실에서 파일을 넘겨 보기만
 * 해도 썸네일 변환이 돌기 때문에, 같은 몫을 쓰면 정작 "미리보기"를 눌렀을 때 429 가 난다.
 */
export const THUMB_RENDER_RATE_LIMIT_PER_MIN = 30

/** 변환을 시작해도 되나. 안 되면 몇 초 뒤에 다시 시도할지(분산 리미터의 창이 1분이라 60초) */
export async function hitRenderLimit(
  userId: string,
  purpose: 'view' | 'thumb' = 'view'
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const result = await consumeWorkRender(userId, purpose)
  return result.ok ? { ok: true } : { ok: false, retryAfterSec: 60 }
}

/** 같은 파일의 반복 실패를 짧게만 기억한다 — 손상·암호 문서를 열 때마다 다시 변환하지 않게 */
export const RENDER_FAILURE_TTL_MS = 5 * 60_000
const FAILURE_MAX_ENTRIES = 500
/** 파일 내용이 같으면 늘 같은 결과인 실패만(시간 초과·서버 오류는 일시적일 수 있어 기억하지 않는다) */
const REMEMBERED: ReadonlySet<RenderErrorCode> = new Set(['encrypted', 'corrupt'])

const failures = new Map<string, { code: RenderErrorCode; until: number }>()

export function recallRenderFailure(key: string, now: number = Date.now()): RenderErrorCode | null {
  const hit = failures.get(key)
  if (!hit) return null
  if (hit.until <= now) {
    failures.delete(key)
    return null
  }
  return hit.code
}

export function rememberRenderFailure(
  key: string,
  code: RenderErrorCode,
  now: number = Date.now()
): void {
  if (!REMEMBERED.has(code)) return
  if (failures.size >= FAILURE_MAX_ENTRIES) {
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k)
    if (failures.size >= FAILURE_MAX_ENTRIES) {
      const oldest = failures.keys().next().value
      if (oldest !== undefined) failures.delete(oldest)
    }
  }
  failures.set(key, { code, until: now + RENDER_FAILURE_TTL_MS })
}

/** 테스트용 — 실패 기억을 비운다 */
export function resetRenderGuards(): void {
  failures.clear()
}
