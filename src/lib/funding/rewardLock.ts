/**
 * 결제된 후원이 붙은 리워드(`locked_at` 있음)의 불변식.
 *
 * 금액·배송 여부는 못 바꾼다 — 이미 낸 사람의 조건이 바뀐다. 수량은 늘리기만
 * 된다 — 줄이면 이미 팔린 수량보다 적어질 수 있다. 무제한(null)은 어떤 유한값보다
 * 크므로 유한→null은 증가, null→유한은 감소다. 관리자도 예외가 없다.
 *
 * 공개 중(`contentOnly`)인 캠페인의 **기존** 리워드는 결제 여부와 무관하게
 * 이름·설명·금액·배송 여부가 잠기고, 수량도 줄일 수 없다 — 목록에 이미 올라간
 * 조건을 후원자가 보고 있으므로, 아직 아무도 후원하지 않았더라도 값을 바꾸면
 * 화면이 보여준 약속이 깨진다. 화면이 약속하는 문장도 같다("공개된 뒤에는
 * 리워드를 추가하거나 수량을 늘릴 수만 있습니다"). 새로 추가하는 리워드는 이
 * 잠금과 무관하다(추가는 언제나 된다).
 *
 * ## 표에 있는 나머지 세 컬럼을 여기서 어떻게 다루는가 — 결정과 근거
 *
 * 리워드 표에는 위 다섯 말고도 `estimated_delivery`·`image_url`·`sort_order`가
 * 있다. 세 컬럼이 이 판정을 그냥 지나가던 것을 2026-09-23 감사에서 잡았고,
 * 아래와 같이 정했다. 다시 논쟁하지 않도록 근거까지 적어 둔다.
 *
 * - **`image_url` — 잠근다.** 사진은 후원자가 보고 고른 것의 일부다. 결제가
 *   끝난 뒤 사진만 갈아 끼우면 같은 이름·같은 금액으로 다른 물건이 된다.
 *   이름·설명과 성질이 같으므로 **같은 가지(`contentOnly`)** 에 둔다. 결제
 *   잠금(`locked_at`) 가지에 따로 두지 않는 이유는 그쪽이 더 느슨해서가 아니라
 *   **결제가 붙은 리워드는 언제나 이 가지도 함께 지나기** 때문이다 — 결제는
 *   공개(`active`) 중에만 확정되고, 전이표에 `active → draft`가 없으며,
 *   `closed`·`settled`는 `editScope`가 `none`이라 아예 못 고친다. 따라서
 *   "결제가 있는데 `contentOnly`가 아닌" 상태는 존재하지 않는다. 사진을 꼭
 *   바꿔야 하는 개설자는 사무국을 거친다.
 * - **`estimated_delivery` — 막지 않는다.** 잠그면 조합이 스스로 공개한 이용약관과
 *   어긋난다. `src/app/[locale]/funding/terms/page.tsx` 제12조는 전달이 늦어지면
 *   개설자가 후원자에게 **알린다**고 정할 뿐 날짜를 얼린다고 하지 않는다. 대신
 *   조용히 바뀌지는 않게 한다 — 바꾼 라우트(리워드 일괄 저장)가 활동 로그에
 *   이전 값과 새 값을 남긴다. (후원자에게 보내는 알림 자체는 별건이다.)
 * - **`sort_order` — 막지 않는다.** 목록에서 보이는 차례일 뿐, 후원자가 무엇을
 *   받는지는 한 글자도 바뀌지 않는다.
 */

export interface RewardLockView {
  title: string
  description: string | null
  amount: number
  requires_shipping: boolean
  total_quantity: number | null
  image_url: string | null
  locked_at: string | null
}

export type RewardEditScope = 'all' | 'contentOnly' | 'none'

export type RewardPatchVerdict =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'locked_amount'
        | 'locked_shipping'
        | 'quantity_decrease'
        | 'content_only_field'
        | 'content_only_image'
        | 'content_only_quantity_decrease'
    }

export interface RewardPatch {
  title?: string
  description?: string | null
  amount?: number
  requires_shipping?: boolean
  total_quantity?: number | null
  image_url?: string | null
  /** 판정하지 않는다 — 위 주석의 결정 근거 참고. 형태만 받아 둔다. */
  estimated_delivery?: string | null
  /** 판정하지 않는다 — 표시 차례일 뿐이다. */
  sort_order?: number
}

/**
 * 빈 텍스트와 값 없음을 같은 것으로 본다.
 *
 * 화면이 보내는 값은 `parseRewardList`의 `str()`을 지난다 — 빈 입력칸은
 * `''`가 되고, 키 자체가 없을 때만 `null`이다. 표에는 `NULL`이 그대로 들어
 * 있을 수 있다(시드·수기 보정·앞으로 생길 관리자 도구). 이 둘을 글자 그대로
 * 비교하면 **개설자가 건드린 적도 없는 사진 때문에** 그 캠페인의 리워드
 * 저장이 영원히 거절된다 — `NULL !== ''`이므로 "사진을 바꿨다"고 판정한다.
 * 사람에게는 둘 다 "없음"이므로 없음끼리는 같다고 본다.
 */
function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '')
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
    if (patch.description !== undefined && !sameText(patch.description, existing.description)) {
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
    // 사진도 이름·설명과 같은 자리다 — 거절 문장을 따로 두는 것은 개설자가
    // 무엇을 어떻게 해야 하는지(사무국 문의)가 다르기 때문이다.
    if (patch.image_url !== undefined && !sameText(patch.image_url, existing.image_url)) {
      return { ok: false, reason: 'content_only_image' }
    }
    // 수량은 늘리기만 된다 — 결제가 아직 없어도 마찬가지다. 결제 잠금
    // (`locked_at`) 검사는 아래에 따로 있지만 여기까지 내려오기 전에 판정해야
    // 한다. 아래 검사는 잠긴 리워드만 보므로, 공개 중이지만 아직 결제가 없는
    // 리워드의 수량 축소가 그대로 통과한다. 이유 코드를 나누는 것은 거절
    // 문장을 사실에 맞추기 위해서다 — 결제가 없는데 "결제가 있어서"라고 적으면
    // 창작자가 존재하지 않는 후원을 찾게 된다.
    if (patch.total_quantity !== undefined && isQuantityDecrease(existing, patch)) {
      return { ok: false, reason: 'content_only_quantity_decrease' }
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
  if (patch.total_quantity !== undefined && isQuantityDecrease(existing, patch)) {
    return { ok: false, reason: 'quantity_decrease' }
  }
  return { ok: true }
}

/** 무제한(null)은 어떤 유한값보다 크다 — 유한→null은 증가, null→유한은 감소다. */
function isQuantityDecrease(existing: RewardLockView, patch: RewardPatch): boolean {
  const before = existing.total_quantity ?? Number.POSITIVE_INFINITY
  const after = patch.total_quantity ?? Number.POSITIVE_INFINITY
  return after < before
}

export function canDeleteReward(existing: { locked_at: string | null }): boolean {
  return !existing.locked_at
}

/** 활동 로그에 남길 예상 전달월 변경 한 건. */
export interface DeliveryChange {
  reward_id: string
  reward_title: string
  from: string | null
  to: string | null
}

/**
 * 예상 전달월이 실제로 바뀐 기존 리워드만 골라 이전 값·새 값과 함께 돌려준다.
 * 잠그지 않기로 한 필드라 거절 판정에는 쓰이지 않는다 — **기록**이 목적이다.
 * 새로 추가하는 리워드(`id` 없음)는 바뀐 것이 없으므로 제외한다.
 */
export function deliveryChangesToLog(
  existing: { id: string; title: string; estimated_delivery: string | null }[],
  incoming: { id?: string; title: string; estimated_delivery?: string | null }[]
): DeliveryChange[] {
  const byId = new Map(existing.map(r => [r.id, r]))
  const changes: DeliveryChange[] = []
  for (const r of incoming) {
    if (!r.id) continue
    const cur = byId.get(r.id)
    if (!cur) continue
    const from = cur.estimated_delivery ?? null
    const to = r.estimated_delivery ?? null
    if (from === to) continue
    changes.push({ reward_id: r.id, reward_title: cur.title, from, to })
  }
  return changes
}
