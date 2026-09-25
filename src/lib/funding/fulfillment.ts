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

/* ------------------------------------------------------------------ 되돌리기
 *
 * 위 `allowedSourcesFor`는 **평상시의 표**다. 개설자도 사무국도 그 표로만
 * 움직이고, 거기서 역행은 `preparing → none` 하나뿐이다. 그 규칙은 그대로
 * 둔다 — 아래 것은 그 표를 넓히는 것이 아니라 **다른 문**이다.
 *
 * ## 왜 다른 문이 필요한가
 *
 * `shipped`를 되돌릴 길이 아무에게도 없다는 것은 "이미 부친 물건에 대해 자동
 * 환불이 다시 열리는 일"을 확실히 막았지만, 그 대가로 **아무것도 부치지 않은
 * 채 전체를 발송 완료로 눌러 버린 캠페인**도 영영 그대로 두게 됐다. 후원자
 * 전원의 자동 취소가 닫히고, 전원이 "보냈습니다" 메일을 받고, 사무국이 할 수
 * 있는 일이 없다.
 *
 * 코드는 두 경우를 구분하지 못한다 — 엉뚱한 행을 눌렀는가, 부치지도 않고
 * 눌렀는가, 아니면 부친 뒤에 환불을 다시 열려고 되돌리는가. 셋은 사람이
 * 구분하는 일이다. 그래서 되돌리기는 **사무국만**, **사유를 적어야**, **어느
 * 경우였는지를 골라야** 통과한다(`FULFILLMENT_REVERSAL_KINDS`). 개설자는
 * 혼자 이 문을 열 수 없고, 열린 기록에는 사무국이 무엇이라고 판단했는지가
 * 남는다.
 */

/** `to`로 **되돌릴** 수 있는 출발 상태들. 사무국 전용 문이 쓴다. */
export function allowedReversalSourcesFor(to: FulfillmentStatus): FulfillmentStatus[] {
  return FULFILLMENT_ORDER.filter(from => rank(from) > rank(to))
}

/**
 * 이 되돌리기가 **자동 취소를 다시 여는가.**
 *
 * `shipped`·`delivered`에서 경계 아래로 내려오는 이동이다. 내려오는 순간 그
 * 후원자는 다시 스스로 전액 취소를 할 수 있게 된다(취소 라우트의 조건이
 * `fulfillment_status === 'none'`이다. `preparing`으로만 내리면 취소는 여전히
 * 닫혀 있다). 이 저장소가 `shipped` 역행을 막아 둔 이유가 정확히 이것이므로,
 * 기록과 화면이 이 이동을 다른 것들과 구분해 말한다.
 */
export function reopensSelfCancel(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return rank(from) >= SENT_RANK && to === 'none'
}

/** 발송 경계를 거꾸로 넘는가 — 후원자에게 "보냈습니다"라고 이미 말한 건인가. */
export function crossesSentBoundaryBackward(
  from: FulfillmentStatus,
  to: FulfillmentStatus
): boolean {
  return rank(from) >= SENT_RANK && rank(to) < SENT_RANK
}

/**
 * 사무국이 고르는 **무슨 일이 있었는가**.
 *
 * 사유를 자유롭게 적는 칸과 따로 둔다. 문장은 사람마다 다르게 쓰지만 이
 * 두 갈래는 나중에 세어 볼 수 있어야 한다 — 같은 개설자에게서 `not_shipped`가
 * 거듭 나오면 그것 자체가 사무국이 읽어야 할 신호다.
 */
export const FULFILLMENT_REVERSAL_KINDS = ['wrong_row', 'not_shipped'] as const
export type FulfillmentReversalKind = (typeof FULFILLMENT_REVERSAL_KINDS)[number]

export const FULFILLMENT_REVERSAL_KIND_LABEL: Record<FulfillmentReversalKind, string> = {
  wrong_row: '엉뚱한 후원을 표시했다',
  not_shipped: '실제로는 발송하지 않았다',
}

export function isFulfillmentReversalKind(value: unknown): value is FulfillmentReversalKind {
  return (
    typeof value === 'string' && (FULFILLMENT_REVERSAL_KINDS as readonly string[]).includes(value)
  )
}

/** 되돌리기 사유의 최소 길이. "실수"만 적고 넘어가지 못하게 한다. */
export const FULFILLMENT_REVERSAL_REASON_MIN = 10
export const FULFILLMENT_REVERSAL_REASON_MAX = 500

/* --------------------------------------------------- 한 번에 쓸어버린 표시
 *
 * 개설자가 이틀째에 후원 전부를 '발송 완료'로 눌러도 코드는 소포가 실제로
 * 부쳐졌는지 알 수 없다. 알 수 있는 것은 **모양**뿐이다 — 한 번의 요청이 이
 * 캠페인 후원자 거의 전부를 발송 경계 위로 올렸는가.
 *
 * 그것만으로 잘못을 단정하지 않는다. 후원자가 열 명인 캠페인에서 하루에 전부
 * 부치는 것은 흔한 일이다. 그래서 이 함수가 하는 일은 **사무국 화면에 표시를
 * 하나 다는 것**뿐이고, 판단은 사람이 한다. 오늘 그 한 줄은 활동 기록 깊숙이
 * 묻혀 아무도 보지 않는다 — 그것이 이 표시가 생긴 이유다.
 */

/** 이 표시를 달기 시작하는 최소 건수. 이보다 적으면 모양이랄 것이 없다. */
export const SWEEPING_MARK_MIN_COUNT = 5
/** 이 비율 이상을 한 번에 올렸으면 표시한다. */
export const SWEEPING_MARK_SHARE = 0.8

export function isSweepingMark(updated: unknown, paidBackerCount: unknown): boolean {
  const n = Number(updated)
  const total = Number(paidBackerCount)
  if (!Number.isFinite(n) || !Number.isFinite(total)) return false
  if (n < SWEEPING_MARK_MIN_COUNT || total <= 0) return false
  return n / total >= SWEEPING_MARK_SHARE
}
