/**
 * 관리자 대리 개설에서 개설자로 지정할 수 있는 사람인가.
 *
 * 사무국이 개설부터 승인까지 혼자 처리하는 일이 흔하다 — 창작자가 계정만 있고
 * 화면을 직접 다루지 못하는 경우다. 그래서 대리 개설은 조합원이 아닌 회원도
 * 개설자로 받는다. 요율은 승인 시점에 `platformFeeRateFor`가 가입 승인 상태로
 * 고른다(조합원 3.3% / 비조합원 5.5%, 둘 다 부가세 포함).
 *
 * 탈퇴한 사람만 막는다 — 정산금을 받을 주체가 없다.
 */
import { isFeeMember, type FeeMemberProfile } from './feeRate.ts'

export type ProxyOwnerProfile = FeeMemberProfile & {
  withdrawn_at?: string | null
}

export type ProxyOwnerVerdict = { ok: true; is_member: boolean } | { ok: false; message: string }

export function proxyOwnerVerdict(
  profile: ProxyOwnerProfile | null | undefined
): ProxyOwnerVerdict {
  if (!profile) return { ok: false, message: '개설자로 지정할 회원을 찾을 수 없습니다.' }
  if (profile.registration_status === 'withdrawn' || profile.withdrawn_at) {
    return { ok: false, message: '탈퇴한 회원은 개설자로 지정할 수 없습니다.' }
  }
  return { ok: true, is_member: isFeeMember(profile) }
}
