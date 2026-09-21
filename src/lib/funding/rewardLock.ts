/**
 * 결제된 후원이 붙은 리워드(`locked_at` 있음)의 불변식.
 *
 * 금액·배송 여부는 못 바꾼다 — 이미 낸 사람의 조건이 바뀐다. 수량은 늘리기만
 * 된다 — 줄이면 이미 팔린 수량보다 적어질 수 있다. 무제한(null)은 어떤 유한값보다
 * 크므로 유한→null은 증가, null→유한은 감소다. 관리자도 예외가 없다.
 */

export interface RewardLockView {
  amount: number
  requires_shipping: boolean
  total_quantity: number | null
  locked_at: string | null
}

export type RewardPatchVerdict =
  | { ok: true }
  | { ok: false; reason: 'locked_amount' | 'locked_shipping' | 'quantity_decrease' }

export function evaluateRewardPatch(
  existing: RewardLockView,
  patch: { amount?: number; requires_shipping?: boolean; total_quantity?: number | null }
): RewardPatchVerdict {
  if (!existing.locked_at) return { ok: true }
  if (patch.amount !== undefined && patch.amount !== existing.amount) {
    return { ok: false, reason: 'locked_amount' }
  }
  if (patch.requires_shipping !== undefined && patch.requires_shipping !== existing.requires_shipping) {
    return { ok: false, reason: 'locked_shipping' }
  }
  if (patch.total_quantity !== undefined) {
    const before = existing.total_quantity ?? Number.POSITIVE_INFINITY
    const after = patch.total_quantity ?? Number.POSITIVE_INFINITY
    if (after < before) return { ok: false, reason: 'quantity_decrease' }
  }
  return { ok: true }
}

export function canDeleteReward(existing: { locked_at: string | null }): boolean {
  return !existing.locked_at
}
