import { DEFAULT_QUIET, isQuietNow, type QuietPrefs } from '../notifications/quiet-hours.ts'

/**
 * 다이제스트 대상 고르기(순수) — 원본 digest_candidates(0027·0047)에서 SQL 밖으로 뺀 조건과 ggac 이식이 더한 조건.
 * `node --test`가 직접 읽는다.
 *
 *  - digest_mode: 'off'(기본)면 보내지 않는다. 'normal'은 10분, 'hourly'는 60분 넘게 안 읽은 것만(원본 cutoff − 50분).
 *  - **이사회 권한·읽기 범위**(ggac 이식): 받는 사람이 지금 업무툴에 들어올 수 있고 그 채널을 읽을 수 있어야 한다
 *    (`canAccess` — 호출부가 canAccessBoardRoom + canReadChannelRow로 판정). 이사에서 빠진 사람에게는 멤버십 행이
 *    남아 있어도 보내지 않는다. 원본의 "활성 staff" 조건 자리다.
 *  - **방해 금지**(ggac 이식 — 원본 0027은 메일에 적용하지 않았다): 방해 금지 시간대인 사람은 이번 실행에서 빼고,
 *    발송 기준(digest_state)을 올리지 않으므로 방해 금지가 끝난 뒤 첫 실행에서 모아 받는다.
 */

/** 기본 대기(원본 DIGEST_DELAY_MS) */
export const DIGEST_DELAY_MS = 10 * 60 * 1000
/** 'hourly'의 추가 대기(원본 `interval '50 minutes'`) — 합쳐서 60분 */
export const DIGEST_HOURLY_EXTRA_MS = 50 * 60 * 1000
/** 발송 이력이 없는 사용자는 이 기간 안의 것만 모은다(첫 실행 폭탄 방지) */
export const DIGEST_FIRST_WINDOW_MS = 24 * 60 * 60 * 1000

export type DigestSelectable = {
  recipient_id: string
  created_at: Date
  recipient_digest_mode: string
  recipient_quiet: QuietPrefs | null
}

/** 이 사람·이 행이 지금 메일로 나갈 만큼 오래됐는가 */
export function isDueForDigest(
  row: Pick<DigestSelectable, 'created_at' | 'recipient_digest_mode'>,
  now: Date
): boolean {
  const mode = row.recipient_digest_mode
  if (mode !== 'normal' && mode !== 'hourly') return false
  const wait = DIGEST_DELAY_MS + (mode === 'hourly' ? DIGEST_HOURLY_EXTRA_MS : 0)
  return row.created_at.getTime() <= now.getTime() - wait
}

export function selectDigestRows<R extends DigestSelectable>(input: {
  rows: readonly R[]
  now: Date
  canAccess: (row: R) => boolean
}): R[] {
  const quietCache = new Map<string, boolean>()
  return input.rows.filter(r => {
    if (!isDueForDigest(r, input.now)) return false
    if (!input.canAccess(r)) return false
    let quiet = quietCache.get(r.recipient_id)
    if (quiet === undefined) {
      quiet = isQuietNow(r.recipient_quiet ?? DEFAULT_QUIET, input.now)
      quietCache.set(r.recipient_id, quiet)
    }
    return !quiet
  })
}

/** 받는 사람별로 묶는다(입력 순서 유지 — 쿼리가 받는 사람·시각 순으로 준다) */
export function groupByRecipient<R extends { recipient_id: string }>(
  rows: readonly R[]
): Map<string, R[]> {
  const map = new Map<string, R[]>()
  for (const r of rows) {
    const list = map.get(r.recipient_id)
    if (list) list.push(r)
    else map.set(r.recipient_id, [r])
  }
  return map
}

/** 보낸 묶음의 새 발송 기준 — **담긴 메시지 중 가장 늦은 created_at**(지금 시각이 아니다 — 원본 run.ts) */
export function latestCreatedAt(rows: readonly Pick<DigestSelectable, 'created_at'>[]): Date {
  let max = rows[0].created_at
  for (const r of rows) if (r.created_at.getTime() > max.getTime()) max = r.created_at
  return max
}
