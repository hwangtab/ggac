/**
 * 펀딩 화면이 쓰는 데이터 모양. 쿼리 계층의 snake_case 응답을 그대로 따른다.
 *
 * **여기에 없는 필드는 화면으로 넘기지 않는다.** 쿼리는 `toSnakeCase`로 키만 바꾼
 * DB 행 전체를 돌려주고, 이 페이지들은 서버 렌더 + ISR이라 넘긴 값이 공개·색인
 * 대상 HTML에 그대로 굳는다. 그래서 타입을 좁히는 데 그치지 않고 **호출부가
 * 필드를 직접 골라 새 객체를 만든다**(타입 단언은 런타임 필터가 아니다).
 *
 * 특히 뺀 것 — `owner_user_id`(창작자의 member_profiles UUID),
 * `platform_fee_rate`(조합 수수료율), `review_note`(관리자가 쓴 반려 사유).
 * API 쪽은 `src/lib/funding/publicCampaign.ts`가 같은 셋을 지운다.
 */

export interface Progress {
  raised_amount: number
  backer_count: number
}

export interface CampaignSummary {
  slug: string
  title: string
  summary: string
  cover_image: string | null
  category: string
  goal_amount: number
  end_at: string | null
  status: string
  progress: Progress
}

export interface Reward {
  /** 후원 요청(`/api/funding/pledges/prepare`)에 실어 보내는 식별자. */
  id: string
  title: string
  description: string | null
  amount: number
  /** null이면 무제한. */
  total_quantity: number | null
  /** null이면 무제한이라 남은 수량을 따지지 않는다. */
  remaining_quantity: number | null
  requires_shipping: boolean
  estimated_delivery: string | null
  image_url: string | null
}

export interface CampaignDetail {
  /** 후원 요청에 실어 보내는 캠페인 식별자. */
  id: string
  slug: string
  title: string
  summary: string
  story: string
  cover_image: string | null
  og_image: string | null
  category: string
  goal_amount: number
  start_at: string | null
  end_at: string | null
  /** `active` | `closed` | `settled` — 공개 상태만 여기 온다. */
  status: string
  rewards: Reward[]
  progress: Progress
}

export interface PublicBacker {
  name: string
  message: string | null
  paid_at: string
}
