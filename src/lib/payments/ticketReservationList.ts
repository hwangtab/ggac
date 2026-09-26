/**
 * 사무국 예매 목록이 **무엇을 묻고 한 줄이 무엇을 말하는가**. DB도 화면도 모른다.
 *
 * ## 왜 목록이 필요한가
 *
 * 사무국 대리 환불(`POST /api/admin/tickets/reservations/[id]/refund`)은 예매
 * id 하나를 받는다. 그런데 관객은 전화로 **예매번호나 이름**을 말한다. 그 둘을
 * 잇는 화면이 없으면 사무국은 id를 찾으러 DB 콘솔에 들어가야 하고, 그 순간
 * 이미 토스 콘솔에서 환불하는 편이 빠르다 — 환불 라우트가 막으려던 바로 그
 * 경로다. 그래서 이 목록은 라우트의 부속이 아니라 **라우트가 쓰이게 하는
 * 조건**이다.
 *
 * ## 판정은 두 벌이지만 권위는 한 벌이다
 *
 * 여기서 정하는 것은 **단추를 그릴지**뿐이다. 환불할 수 있는지의 정본은
 * 서버의 `planTicketOfficeRefund`이고, 이 파일이 참이라고 말한 줄도 거기서
 * 다시 걸러진다. 반대는 성립하지 않는다 — 여기서 막힌 줄은 요청 자체가 가지
 * 않으므로, 이 파일이 **덜 열어 주는** 쪽으로 틀리면 사무국은 길이 없다고
 * 믿게 된다. 그래서 판정 근거를 원장 값 그대로(`refundable_amount`) 받고,
 * 못 누르는 줄에는 **왜 못 누르는지**를 함께 적는다(`hint`).
 *
 * 펀딩 쪽의 `src/lib/funding/pledgeRowState.ts`와 같은 자리의 같은 물건이다.
 */

/** 예매 상태. 스키마의 `RESERVATION_STATUS`와 같은 목록이다(값이 갈리면 필터가 빈다). */
export const ADMIN_RESERVATION_STATUSES = ['pending', 'confirmed', 'canceled', 'expired'] as const

export type AdminReservationStatus = (typeof ADMIN_RESERVATION_STATUSES)[number]

/** 한 번에 읽는 줄 수. 사무국은 전화를 받으며 보므로 한 화면에 들어갈 만큼만. */
export const RESERVATION_LIST_DEFAULT_LIMIT = 30
/** 손으로 `limit`을 키워도 여기까지. 예매 표는 지우지 않아 시간이 갈수록 커진다. */
export const RESERVATION_LIST_MAX_LIMIT = 100
/** 검색어 상한. 이보다 긴 입력은 잘라서 넘긴다(LIKE 패턴이 길어질 이유가 없다). */
export const RESERVATION_SEARCH_MAX = 100

export interface ReservationListQuery {
  performanceId: string | null
  status: AdminReservationStatus | null
  search: string | null
  limit: number
  offset: number
}

function readInt(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * 주소창의 질의 문자열 → 쿼리 계층이 받는 필터.
 *
 * **모르는 값은 필터를 거는 대신 버린다.** 상태 이름을 잘못 적은 요청에
 * 400을 돌려주면 드롭다운 하나 때문에 화면이 빈칸이 되는데, 이 자리에서
 * 틀린 값은 공격이 아니라 오타다. 대신 버렸다는 사실이 보이도록 화면은
 * 고른 값을 스스로 갖고 있는다(서버 응답을 되읽지 않는다).
 *
 * 받는 것은 `URLSearchParams`이지만 `get` 하나만 쓴다 — 테스트가 평범한
 * 객체를 넘길 수 있고, 이 파일이 next를 끌어오지 않는다.
 */
export function parseReservationListQuery(params: {
  get(name: string): string | null
}): ReservationListQuery {
  const performanceId = (params.get('performanceId') ?? '').trim()
  const status = (params.get('status') ?? '').trim()
  const search = (params.get('q') ?? '').trim()

  const rawLimit = readInt(params.get('limit'))
  const limit =
    rawLimit === null || rawLimit <= 0
      ? RESERVATION_LIST_DEFAULT_LIMIT
      : Math.min(rawLimit, RESERVATION_LIST_MAX_LIMIT)

  const rawOffset = readInt(params.get('offset'))
  const offset = rawOffset === null || rawOffset < 0 ? 0 : rawOffset

  return {
    performanceId: performanceId.length > 0 ? performanceId : null,
    status: (ADMIN_RESERVATION_STATUSES as readonly string[]).includes(status)
      ? (status as AdminReservationStatus)
      : null,
    search: search.length > 0 ? search.slice(0, RESERVATION_SEARCH_MAX) : null,
    limit,
    offset,
  }
}

/**
 * 원장에서 아직 돌려주지 않은 금액. `planTicketOfficeRefund`의 `remaining`과
 * 같은 뺄셈이고, 화면은 이 값을 상한으로 부분 환불 칸을 검사한다.
 */
export function refundableWon(amount: unknown, canceledAmount: unknown): number {
  const paid = Number(amount)
  const canceled = Number(canceledAmount)
  if (!Number.isSafeInteger(paid) || paid <= 0) return 0
  const already = Number.isSafeInteger(canceled) && canceled > 0 ? canceled : 0
  return Math.max(0, paid - already)
}

/** 판정에 쓰는 것은 한 줄의 세 칸뿐이다. */
export interface ReservationRowFacts {
  status: string
  /** 결제 행이 붙어 있고 토스 키까지 있는가 — 곧 "돌려줄 결제가 있는가". */
  has_payment: boolean
  /** 아직 돌려주지 않은 금액(원). */
  refundable_amount: number
}

export type ReservationRowTone = 'neutral' | 'warn' | 'done'

export interface ReservationRowState {
  label: string
  tone: ReservationRowTone
  /** 지금 환불 단추를 그릴 줄인가. */
  canRefund: boolean
  /** 왜 못 누르는지, 혹은 왜 눈여겨봐야 하는지 한 줄. 평범한 줄에는 없다. */
  hint: string | null
}

const NO_PAYMENT_HINT =
  '결제 정보가 없습니다. 돈이 실제로 잡혔다면 토스 거래 내역을 먼저 확인해 주세요.'
const FULLY_REFUNDED_HINT = '이미 전액이 환불된 결제입니다.'
const PENDING_WITH_PAYMENT_HINT =
  '결제는 잡혔는데 예매가 확정되지 않았습니다. 돈이 나간 채 좌석만 뜬 상태일 수 있으니 확인한 뒤 환불해 주세요.'

export function reservationRowState(
  row: ReservationRowFacts | null | undefined
): ReservationRowState {
  const status = typeof row?.status === 'string' ? row.status : ''
  const hasPayment = row?.has_payment === true
  const refundable = Number(row?.refundable_amount)
  const remaining = Number.isSafeInteger(refundable) && refundable > 0 ? refundable : 0

  if (status === 'canceled') {
    return { label: '취소됨', tone: 'done', canRefund: false, hint: null }
  }
  if (status === 'expired') {
    return { label: '기한 만료', tone: 'neutral', canRefund: false, hint: null }
  }

  if (status === 'confirmed' || status === 'pending') {
    // 좌석을 쥐고 있는 두 상태. 여기서 갈리는 것은 **돌려줄 돈이 있는가**다.
    const label = status === 'confirmed' ? '예매 확정' : '결제 대기'
    if (!hasPayment) {
      return {
        label,
        tone: status === 'confirmed' ? 'warn' : 'neutral',
        canRefund: false,
        // 확정인데 결제가 없는 것은 이상한 상태다. 대기 중인 선점은 정상이다.
        hint: status === 'confirmed' ? NO_PAYMENT_HINT : null,
      }
    }
    if (remaining <= 0) {
      return { label, tone: 'done', canRefund: false, hint: FULLY_REFUNDED_HINT }
    }
    return {
      label,
      tone: status === 'pending' ? 'warn' : 'neutral',
      canRefund: true,
      hint: status === 'pending' ? PENDING_WITH_PAYMENT_HINT : null,
    }
  }

  return { label: status || '알 수 없음', tone: 'neutral', canRefund: false, hint: null }
}
