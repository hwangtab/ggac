/**
 * 리워드 이행 상태 전이의 **정본**. 라우트와 화면은 이 표를 물어보고만 움직인다.
 *
 * 캠페인 전이(`./transitions.ts`)와 같은 자리에 있는 같은 종류의 표다. 다른
 * 점은 이 표가 **돈을 지킨다**는 것이다 — 후원 취소 라우트가 "이행이 시작되지
 * 않은 후원만 자동 환불"을 조건으로 걸고 있는데, 이 컬럼을 아무도 쓰지 않아
 * 그 조건이 한 번도 걸린 적이 없었다. 개설자가 리워드를 부친 뒤에도 후원자가
 * 전액 자동 환불을 받을 수 있었다는 뜻이다(물건과 돈을 둘 다 잃는다).
 *
 * ## 전진만 한다
 *
 * `none → preparing → shipped → delivered` 순서이고, **건너뛰는 전진은
 * 허용한다** — 준비 단계를 따로 표시하지 않고 곧장 부치는 개설자가 흔하고,
 * 현장에서 손에 쥐여 주는 리워드는 `shipped`를 거치지 않는다.
 *
 * ## 역행은 사무국의 `preparing → none` 하나뿐이다
 *
 * `shipped`·`delivered`를 되돌리면 **이미 우체국에 들어간 물건에 대해 자동
 * 환불이 다시 열린다.** 이 작업이 막으려는 손실이 바로 그것이므로 누구에게도
 * 열지 않는다 — 개설자에게도, 관리자에게도.
 *
 * `preparing → none`만 **관리자(사무국)**에게 연다. `preparing`은 아직 아무것도
 * 나가지 않은 상태라 되돌려도 잃을 물건이 없고, 개설자가 잘못 누른 탓에
 * 후원자가 스스로 취소할 길을 잃었을 때 그 길을 돌려주는 유일한 수단이다.
 * 개설자 자신에게는 열지 않는다 — 잘못 누른 사람이 혼자 되돌리면 "준비를
 * 시작했다"는 기록이 아무 무게도 갖지 못한다.
 *
 * ## 캠페인이 어떤 상태일 때 움직일 수 있는가
 *
 * `active`·`closed`·`settled`. **`active`를 포함하는 것이 중요하다** — 약관
 * 제4조가 "캠페인이 진행 중이고 리워드 준비가 시작되기 전이라면 직접 전액
 * 취소할 수 있다"고 정한다. 곧 진행 중에도 준비는 시작될 수 있고, 시작되면
 * 자동 취소가 닫히고 사무국 경유로 바뀐다. 이행을 마감 뒤로만 열면 취소
 * 라우트의 그 조건은 여전히 영영 걸리지 않는다(두 조건이 `active` AND
 * `fulfillment='none'`의 곱이기 때문이다).
 */

export const FULFILLMENT_ORDER = ['none', 'preparing', 'shipped', 'delivered'] as const

export type FulfillmentStatus = (typeof FULFILLMENT_ORDER)[number]

/** 이행을 움직일 수 있는 캠페인 상태. */
export const FULFILLABLE_CAMPAIGN_STATUSES = ['active', 'closed', 'settled'] as const

export function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return typeof value === 'string' && (FULFILLMENT_ORDER as readonly string[]).includes(value)
}

export function isFulfillableCampaignStatus(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    (FULFILLABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status)
  )
}

function rank(status: FulfillmentStatus): number {
  return FULFILLMENT_ORDER.indexOf(status)
}

/** 물건이 후원자에게 떠났다고 보는 경계. 이 위로 올라가면 자동 취소가 닫힌다. */
const SENT_RANK = rank('shipped')

/**
 * `to`로 옮길 수 있는 **출발 상태들**. 조건부 쓰기의 `WHERE` 절에 그대로 쓴다.
 *
 * 비어 있으면 그 이동은 아무 자리에서도 불가능하다(`none`을 일반 사용자가
 * 고르는 경우).
 */
export function allowedSourcesFor(to: FulfillmentStatus, isAdmin: boolean): FulfillmentStatus[] {
  if (to === 'none') return isAdmin ? ['preparing'] : []
  return FULFILLMENT_ORDER.filter(from => rank(from) < rank(to))
}

export function canTransitionFulfillment(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
  isAdmin: boolean
): boolean {
  return allowedSourcesFor(to, isAdmin).includes(from)
}

/**
 * 이 이동이 **후원자에게 알릴 일**인가.
 *
 * 알리는 것은 "보냈습니다" 한 번뿐이다. `preparing`은 개설자의 내부 단계라
 * 후원자가 할 일이 없고, `delivered`는 이미 물건을 받은 사람에게 받았다고
 * 알리는 꼴이다. 건너뛰는 전진(`none → delivered`)도 경계를 넘으므로 한 번
 * 알린다 — 그 사람도 물건이 떠난 것은 마찬가지다.
 */
export function crossesSentBoundary(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return rank(from) < SENT_RANK && rank(to) >= SENT_RANK
}

/** 개설자 화면과 내보내기 파일이 함께 쓰는 한국어 표기. */
export const FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
  none: '준비 전',
  preparing: '준비 중',
  shipped: '발송 완료',
  delivered: '전달 완료',
}
