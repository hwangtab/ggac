/**
 * 회원의 권한을 내리는 액션이 **관리자 화면 자체를 잠가 버리는가** — 이 질문의
 * 답은 여기서만 정한다.
 *
 * `/api/admin/member-action`과 `/api/admin/members/bulk`는 승인된 회원을
 * 비활성·정지·거부로 내린다. 그런데 대상이 누구인지는 보지 않았다. 그래서
 * 관리자가 자기 자신을 비활성화하거나 정지할 수 있었고, 관리자가 한 사람뿐인
 * 조합에서는 그 한 번으로 **관리자 API 전부가 닫혔다** — `requireAdmin()`이
 * 보는 조건이 정확히 `registration_status='approved' && is_active && is_admin`
 * 이라(`src/lib/server/authz.ts`의 `isApprovedActiveAdmin`) 비활성·정지가 그
 * 조건을 무너뜨린다. 화면에서 다시 올릴 방법은 없다. 남는 길은 DB를 직접
 * 고치는 것뿐이다.
 *
 * 탈퇴 확정은 이 파일을 쓰지 않는다 — 그쪽은 되돌릴 수 없어서 판정이 쿼리
 * 계층의 단일 UPDATE 안에 원자적으로 들어가 있다(`src/db/queries/
 * withdrawal.ts`). 여기서 막는 것은 **되돌릴 수는 있지만 되돌릴 사람이 남지
 * 않는** 액션들이다.
 *
 * 이 파일은 **아무것도 import 하지 않는다.** 판정에 필요한 것을 호출부가
 * 조립해 넘기므로 데이터베이스 없이 전수 테스트할 수 있다
 * (`scripts/testing/adminLockoutGuard.test.mjs`).
 */

/**
 * 관리자 자격을 빼앗는 액션과, 거절 문장에 들어갈 동사.
 *
 * `approve`·`activate`·`unsuspend`는 자격을 되돌려 주는 쪽이라 없다.
 * `reject`는 승인 대기 회원만 대상이어서 현재 라우트에서는 관리자에게 닿지
 * 않지만, 자격 조건이 느슨해지는 날 조용히 구멍이 되지 않도록 함께 둔다.
 */
const LOCKOUT_ACTION_LABELS = {
  reject: '거부',
  deactivate: '비활성화',
  suspend: '정지',
} as const

export type AdminLockoutAction = keyof typeof LOCKOUT_ACTION_LABELS

export function isAdminLockoutAction(action: string): action is AdminLockoutAction {
  return Object.prototype.hasOwnProperty.call(LOCKOUT_ACTION_LABELS, action)
}

export interface AdminLockoutInput {
  action: AdminLockoutAction
  /** 액션을 누른 관리자 */
  actorId: string
  /** 액션의 대상 회원 */
  targetId: string
  /**
   * 대상이 **지금** 관리자 게이트를 통과하는가
   * (`isApprovedActiveAdmin` — 승인·활성·관리자).
   */
  targetIsActiveAdmin: boolean
  /**
   * 이 액션이 끝난 뒤 **관리자 게이트를 통과한 채로 남는 관리자 수**
   * (대상은 빼고 센다). 대상이 관리자가 아니면 아무도 줄어들지 않으므로
   * 호출부가 세지 않아도 되고, 이 값은 보지 않는다.
   *
   * 대량 작업은 "한 번에 내리는 관리자 전원"을 뺀 수를 넘긴다 — 한 명씩
   * 보면 매번 남는 사람이 있어 보이지만 전부 처리하면 아무도 남지 않는
   * 모양을 그래야 잡는다.
   */
  remainingActiveAdminCount: number
}

export type AdminLockoutVerdict =
  | { blocked: false }
  | { blocked: true; reason: 'self' | 'last_admin'; message: string }

/**
 * 자기 자신이 우선이다 — 마지막 관리자가 자기 자신을 내리려는 경우 둘 다
 * 걸리지만, 사람이 먼저 알아야 할 것은 "남을 시키세요"가 아니라 "당신
 * 계정으로는 안 됩니다"다.
 */
export function adminLockoutVerdict(input: AdminLockoutInput): AdminLockoutVerdict {
  const label = LOCKOUT_ACTION_LABELS[input.action]

  if (input.actorId && input.targetId && input.actorId === input.targetId) {
    return {
      blocked: true,
      reason: 'self',
      message: `자기 자신은 ${label}할 수 없습니다.`,
    }
  }

  if (input.targetIsActiveAdmin && (Number(input.remainingActiveAdminCount) || 0) <= 0) {
    return {
      blocked: true,
      reason: 'last_admin',
      message: `마지막 관리자는 ${label}할 수 없습니다. 다른 관리자를 먼저 지정해주세요.`,
    }
  }

  return { blocked: false }
}
