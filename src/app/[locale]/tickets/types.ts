/**
 * 예매 화면이 쓰는 공연 데이터 모양. 쿼리 계층의 snake_case 응답을 그대로 따른다.
 *
 * **여기에 없는 필드는 화면으로 넘기지 않는다.** 쿼리(`getPerformanceDetail`·
 * `listOpenPerformances`)는 `toSnakeCase`로 키만 바꿔 DB 행 전체를 돌려주고,
 * 이 페이지들은 서버 렌더 + ISR이라 넘긴 값이 공개·색인 대상 HTML에 그대로
 * 굳는다. 그래서 타입을 좁히는 데 그치지 않고 **호출부가 필드를 직접 골라
 * 새 객체를 만든다**(타입 단언은 런타임 필터가 아니다).
 *
 * 특히 뺀 것:
 * - `created_by` — 공연을 만든 관리자의 member_profiles UUID
 * - `capacity` — 회차 정원(판매 실적이 역산된다). 표시에 필요한 것은
 *   `remaining_seats`뿐이다
 * - 내부 `id`·`created_at`·`updated_at` (회차·티켓 종류의 `id`는 예매 요청에
 *   실어 보내야 해서 남긴다)
 */

export interface PerformanceSummary {
  slug: string
  title: string
  summary: string | null
  venue: string | null
  poster_image: string | null
  next_show_at: string | null
  show_count: number
}

export interface Show {
  /** 예매 요청(`/api/tickets/prepare`)에 실어 보내는 회차 식별자. */
  id: string
  starts_at: string
  remaining_seats: number
  is_past: boolean
}

export interface TicketType {
  /** 예매 요청에 실어 보내는 티켓 종류 식별자. */
  id: string
  name: string
  price: number
  max_per_order: number
  members_only: boolean
}

export interface PerformanceDetail {
  slug: string
  title: string
  summary: string | null
  description: string | null
  venue: string | null
  poster_image: string | null
  notice_text: string | null
  /** `draft` | `open` | `closed` | `canceled` — 공개 여부와 JSON-LD 판정에 쓴다. */
  status: string
  shows: Show[]
  ticket_types: TicketType[]
}
