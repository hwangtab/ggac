/**
 * 결제된 후원이 붙은 리워드(`locked_at` 있음)의 불변식.
 *
 * 금액·배송 여부는 못 바꾼다 — 이미 낸 사람의 조건이 바뀐다. 수량은 늘리기만
 * 된다 — 줄이면 이미 팔린 수량보다 적어질 수 있다. 무제한(null)은 어떤 유한값보다
 * 크므로 유한→null은 증가, null→유한은 감소다. 관리자도 예외가 없다.
 *
 * 공개 중(`contentOnly`)인 캠페인의 **기존** 리워드는 결제 여부와 무관하게
 * 이름·설명·금액·배송 여부가 잠긴다 — 목록에 이미 올라간 조건을 후원자가
 * 보고 있으므로, 아직 아무도 후원하지 않았더라도 값을 바꾸면 화면이 보여준
 * 약속이 깨진다. 새로 추가하는 리워드는 이 잠금과 무관하다(추가는 언제나
 * 된다).
 */

export interface RewardLockView {
  title: string
  description: string | null
  amount: number
  requires_shipping: boolean
  total_quantity: number | null
  locked_at: string | null
}

export type RewardEditScope = 'all' | 'contentOnly' | 'none'

export type RewardPatchVerdict =
  | { ok: true }
  | {
      ok: false
      reason: 'locked_amount' | 'locked_shipping' | 'quantity_decrease' | 'content_only_field'
    }

export interface RewardPatch {
  title?: string
  description?: string | null
  amount?: number
  requires_shipping?: boolean
  total_quantity?: number | null
}

export function evaluateRewardPatch(
  existing: RewardLockView,
  patch: RewardPatch,
  scope: RewardEditScope = 'all'
): RewardPatchVerdict {
  // 공개 중인 기존 리워드는 결제 여부와 무관하게 이름·설명·금액·배송을
  // 잠근다 — 잠금(locked_at) 검사보다 먼저 본다. 순서가 바뀌면 결제가 아직
  // 없는데도 "결제가 있어 못 바꾼다"는 틀린 이유를 댈 수 있다.
  if (scope === 'contentOnly') {
    if (patch.title !== undefined && patch.title !== existing.title) {
      return { ok: false, reason: 'content_only_field' }
    }
    if (patch.description !== undefined && patch.description !== existing.description) {
      return { ok: false, reason: 'content_only_field' }
    }
    if (patch.amount !== undefined && patch.amount !== existing.amount) {
      return { ok: false, reason: 'content_only_field' }
    }
    if (
      patch.requires_shipping !== undefined &&
      patch.requires_shipping !== existing.requires_shipping
    ) {
      return { ok: false, reason: 'content_only_field' }
    }
  }
  if (!existing.locked_at) return { ok: true }
  if (patch.amount !== undefined && patch.amount !== existing.amount) {
    return { ok: false, reason: 'locked_amount' }
  }
  if (
    patch.requires_shipping !== undefined &&
    patch.requires_shipping !== existing.requires_shipping
  ) {
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
