/**
 * 심사 화면이 캠페인 하나의 상세 응답에서 **화면으로 넘길 것만** 골라 담는다.
 *
 * `GET /api/mypage/funding/campaigns/[id]`는 개설자 화면을 위해 만든 응답이라
 * 후원자 명단(`pledges`)까지 들어 있다 — 이름·이메일·전화·우편번호·주소·메모.
 * 심사는 "이 내용을 공개해도 되는가"를 판정하는 일이지 후원자를 들여다보는
 * 일이 아니다. 그래서 라우트를 새로 만드는 대신 **여기서 싣는 목록**을 정한다
 * (지우는 목록이 아니라 싣는 목록이라, 응답에 키가 늘어도 저절로 새지 않는다).
 */

export interface ReviewReward {
  id: string
  title: string
  description: string | null
  amount: number
  total_quantity: number | null
  requires_shipping: boolean
  requires_credit_name: boolean
  estimated_delivery: string | null
  /** 승인 뒤에는 잠기는 값이다 — 관리자가 보지 못한 채 얼어붙으면 안 된다. */
  image_url: string | null
}

export interface CampaignDetail {
  story: string
  rewards: ReviewReward[]
  /** 이 상세를 읽은 시점의 판 번호(`updated_at`). 승인할 때 그대로 돌려보낸다. */
  version: string
}

type Json = Record<string, unknown>

export function toReviewDetail(data: unknown): CampaignDetail {
  const d = (data ?? {}) as Json
  const campaign = (d.campaign ?? {}) as Json
  const rewards = Array.isArray(d.rewards) ? (d.rewards as Json[]) : []
  return {
    story: typeof campaign.story === 'string' ? campaign.story : '',
    rewards: rewards.map(r => ({
      id: String(r.id),
      title: String(r.title ?? ''),
      description: typeof r.description === 'string' ? r.description : null,
      amount: Number(r.amount ?? 0),
      total_quantity:
        r.total_quantity === null || r.total_quantity === undefined
          ? null
          : Number(r.total_quantity),
      requires_shipping: Boolean(r.requires_shipping),
      requires_credit_name: Boolean(r.requires_credit_name),
      estimated_delivery: typeof r.estimated_delivery === 'string' ? r.estimated_delivery : null,
      image_url: typeof r.image_url === 'string' && r.image_url !== '' ? r.image_url : null,
    })),
    version: typeof campaign.updated_at === 'string' ? campaign.updated_at : '',
  }
}
