// 상대경로 + 명시적 확장자 — `scripts/testing/timebankAuth.test.mjs`가 plain
// `node --test`로 이 파일을 직접 import한다. `src/lib/server/timebankAuth.ts`는
// `next/server`·`@/` 별칭을 쓰므로 판정 표를 여기 순수 모듈로 떼어 둔다.
import type { Party } from './rules.ts'

/**
 * 타임뱅크 참여 판정(스펙 §7.2 스위치·§9.3 탈퇴 신청 중 동결·§9.4 이용규칙 판).
 * 승인·활성 조합원인지는 그 앞의 `requireActiveMember()`가 이미 걸렀다.
 *
 * 모드:
 * - `read`  — 목록·상세·댓글 읽기. 꺼져도, 미동의여도, 동결이어도 연다(§7.2).
 * - `peer`  — 참여자 명단·재능 디렉터리. 꺼져도 읽지만 **현재 판 동의자끼리만**
 *             (§7.1 "참여 사실과 이름은 참여자끼리 보인다", 이용규칙 제17조).
 * - `write` — 글쓰기·댓글·자원·프로필. 켜짐 + 활성 + 동결 아님 + 현재 판 동의.
 * - `agree` — 동의. 켜짐 + 활성 + 동결 아님(미동의·구판이 동의하러 오는 자리다).
 */
export type TimebankAccessMode = 'read' | 'peer' | 'write' | 'agree'

export type TimebankAccess =
  | 'ok'
  | 'disabled'
  | 'not_agreed'
  | 'terms_outdated'
  | 'frozen'
  | 'inactive'

/** 응답 문구. E2E가 정확히 단정한다(계획 Task 7 표). */
export const TIMEBANK_ACCESS_MESSAGES: Record<Exclude<TimebankAccess, 'ok'>, string> = {
  disabled: '타임뱅크가 지금 꺼져 있습니다.',
  not_agreed: '타임뱅크 이용규칙에 먼저 동의해 주세요.',
  terms_outdated: '바뀐 이용규칙에 다시 동의해 주세요.',
  frozen: '탈퇴 신청 중에는 타임뱅크를 이용할 수 없습니다.',
  inactive: '승인된 조합원만 이용할 수 있습니다.',
}

/**
 * @param agreed 어느 판이든 동의한 적이 있다(`agreed_at` 있음). 현재 판 여부는
 *   `party.terms_current`가 말한다. 둘을 나눠야 미동의와 구판 동의의 문구가 갈린다.
 */
export function classifyTimebankAccess(input: {
  settings: { enabled: unknown }
  party: Party | null
  agreed: boolean
  mode: TimebankAccessMode
}): TimebankAccess {
  const { settings, party, agreed, mode } = input
  if (mode === 'read') return 'ok'

  const agreement = (): TimebankAccess =>
    party?.terms_current === true ? 'ok' : agreed === true ? 'terms_outdated' : 'not_agreed'

  if (mode === 'peer') return agreement()

  // 스위치는 `=== true`만 켜짐이다(설정 조회 실패·행 누락 = 꺼짐).
  if (settings?.enabled !== true) return 'disabled'
  if (party && party.approved_active !== true) return 'inactive'
  if (party?.withdrawal_requested === true) return 'frozen'
  if (mode === 'agree') return 'ok'
  return agreement()
}

/**
 * 레이트리밋 키. **IP가 아니라 사람을 센다** — 같은 공유기 뒤 조합원끼리 카운터를
 * 나눠 쓰지 않고, 한 사람이 IP를 바꿔 가며 상한을 우회하지 못하게 한다
 * (`accountRevealRateLimitKey`와 같은 방식). 인가를 통과한 뒤에만 부른다.
 */
export function timebankRateLimitKey(action: string, userId: string): string {
  return `rate_limit:timebank:${action}:${userId}`
}
