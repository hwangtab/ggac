/**
 * 리워드 탭이 쓰는 순수 함수. 화면(hooks·JSX)과 분리해 둔 이유는 이 파일만
 * `node --test`로 곧장 검증할 수 있게 하기 위해서다(`basicInfoValidation.ts`와
 * 같은 이유).
 *
 * **규칙의 정본은 서버다**(`@/lib/funding/rewardLock`). 여기 있는 함수는 그
 * 판정을 다시 구현하지 않는다 — 화면에 무엇을 비활성하고 어떤 최소값을 걸지
 * 계산할 뿐이고, 실제 판정(`evaluateRewardPatch`)은 저장 요청을 받는 서버가
 * 한다. 다만 결제 잠금(`locked_at`)이 있으면 그 판정 결과를 이 화면에서도
 * 미리 알 수 있으므로(수량 감소는 항상 거절된다), 제출 전에 한 번 더 막아
 * 리워드 전체 저장이 통째로 거절되는 일을 줄인다.
 */
import type { RewardRow } from './RewardsTab'

export function isTempId(id: string): boolean {
  return id.startsWith('temp:')
}

export function makeTempId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  return `temp:${random}`
}

/** 화면에 보이는 순서와 `sort_order`를 늘 맞춘다 — 추가·삭제·이동마다 부른다. */
export function withSequentialSortOrder(rows: RewardRow[]): RewardRow[] {
  return rows.map((r, i) => (r.sort_order === i ? r : { ...r, sort_order: i }))
}

/** 목록에서 `index` 자리를 한 칸 위(-1)나 아래(1)로 옮긴다. 경계를 넘으면
 * 그대로 돌려준다. */
export function moveReward(rows: RewardRow[], index: number, direction: -1 | 1): RewardRow[] {
  const target = index + direction
  if (target < 0 || target >= rows.length || index < 0 || index >= rows.length) return rows
  const next = rows.slice()
  const tmp = next[index]
  next[index] = next[target]
  next[target] = tmp
  return withSequentialSortOrder(next)
}

export interface RewardLockState {
  /** 이름·설명을 잠그는가. 결제 잠금은 이름·설명을 건드리지 않는다(서버
   * `evaluateRewardPatch` 참고) — 공개 중 기존 리워드만 잠근다. */
  nameDescDisabled: boolean
  /** 금액·배송 여부를 잠그는가. 결제 잠금과 공개 중 기존 리워드 둘 다. */
  amountShippingDisabled: boolean
  /** 삭제 버튼을 아예 없애는가(비활성이 아니라 부재). */
  deleteHidden: boolean
  /** 수량 입력의 `min`. null이면 하한이 없다(무제한 포함 자유). */
  quantityMin: number | null
  /** 결제 때문에 잠겼다는 문장(`rewardLocked`)을 이 행에 보이는가. 공개
   * 중이라서 걸리는 잠금은 상단 공지(`rewardsActiveNotice`)가 맡고, 행마다
   * 같은 문장을 되풀이하지 않는다 — 결제 잠금 문장은 "이미 후원이 들어온
   * 리워드입니다"라서 결제가 진짜 원인일 때만 사실이다. */
  showLockedReason: boolean
}

export function computeRewardLockState(
  row: { locked_at: string | null },
  isNew: boolean,
  editScope: 'all' | 'contentOnly' | 'none',
  baselineQuantity: number | null
): RewardLockState {
  const readOnly = editScope === 'none'
  const paymentLocked = row.locked_at !== null
  // 공개된 뒤(contentOnly)에는 이번 세션에 새로 추가한 리워드(temp id)만
  // 자유롭다 — 이미 있던 리워드는 결제 여부와 무관하게 이름·설명·금액·배송을
  // 잠그고 삭제를 감춘다(브리프 2문단).
  const scopeLocked = editScope === 'contentOnly' && !isNew
  const amountShippingDisabled = readOnly || paymentLocked || scopeLocked
  const nameDescDisabled = readOnly || scopeLocked
  const deleteHidden = readOnly || paymentLocked || scopeLocked
  const quantityFloored = !readOnly && (paymentLocked || scopeLocked)
  return {
    nameDescDisabled,
    amountShippingDisabled,
    deleteHidden,
    quantityMin: quantityFloored ? baselineQuantity : null,
    showLockedReason: paymentLocked && !readOnly,
  }
}

/** `min`이 null이면 하한이 없다. null(무제한)은 어떤 유한값보다 크다 —
 * `rewardLock.ts`의 무한대 규칙과 같다. */
export function isQuantityBelowMin(next: number | null, min: number | null): boolean {
  if (min === null) return false
  const nextVal = next === null ? Number.POSITIVE_INFINITY : next
  return nextVal < min
}

/** 수량 입력이 하한 아래로 내려가지 않게 즉시 끌어올린다(타이핑 중에도
 * 적용해 `min` 속성을 우회한 값이 애초에 상태에 들어오지 않게 한다). */
export function clampQuantityToMin(next: number | null, min: number | null): number | null {
  if (!isQuantityBelowMin(next, min)) return next
  return min
}

export interface RewardPayloadItem {
  id?: string
  title: string
  description: string | null
  amount: number
  total_quantity: number | null
  requires_shipping: boolean
  estimated_delivery: string | null
  image_url: string | null
  sort_order: number
}

/** PUT 본문으로 보낼 배열. 기존 것은 `id`를 싣고, 이번 세션에 새로 만든
 * 것(temp id)은 `id`를 아예 빼서 서버가 새로 만들게 한다. */
export function buildRewardsPayload(rows: RewardRow[]): RewardPayloadItem[] {
  return rows.map(r => {
    const item: RewardPayloadItem = {
      title: r.title,
      description: r.description,
      amount: r.amount,
      total_quantity: r.total_quantity,
      requires_shipping: r.requires_shipping,
      estimated_delivery: r.estimated_delivery,
      image_url: r.image_url,
      sort_order: r.sort_order,
    }
    if (!isTempId(r.id)) item.id = r.id
    return item
  })
}

/** 금액 입력 표시값. 0이면(새 리워드 기본값) 빈 문자열이다 — 0원짜리
 * 리워드를 만들 수는 없으므로 0은 "아직 안 정함"과 같다. */
export function formatAmountDisplay(amount: number): string {
  return amount > 0 ? amount.toLocaleString('ko-KR') : ''
}

/** 입력 중인 문자열에서 숫자만 남겨 금액으로 바꾼다(개설·기본 정보 화면과
 * 같은 규칙 — 입력 중엔 자르지 않는다). */
export function parseAmountInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '')
  return digits === '' ? 0 : Number(digits)
}

/** 수량 입력 표시값. 빈 문자열은 무제한(null)이다. */
export function parseQuantityInput(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, '')
  return digits === '' ? null : Number(digits)
}
