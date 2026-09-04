/** 예매 화면이 쓰는 공연 데이터 모양. 쿼리 계층의 snake_case 응답을 그대로 따른다. */

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
  id: string
  starts_at: string
  capacity: number
  remaining_seats: number
  is_past: boolean
}

export interface TicketType {
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
  status: string
  shows: Show[]
  ticket_types: TicketType[]
}
