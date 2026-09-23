'use client'

/**
 * 리워드 탭 — 최소 스텁. Task 6이 이 자리에 리워드 추가·수정·삭제 UI를
 * 채운다. 서버 잠금 규칙(`@/lib/funding/rewardLock`)은 이미 있다 — 결제가
 * 붙은 리워드는 금액·배송 여부를 못 바꾸고 수량은 늘리기만 된다. `locked_at`
 * 필드를 그대로 내려주는 이유는 Task 6이 행마다 잠금 여부를 판단해야
 * 하기 때문이다.
 *
 * 껍데기가 `rewards` 배열을 소유하고 `onChange`로만 갱신을 받는다 — 기본
 * 정보 탭과 같은 제어 컴포넌트 계약이다.
 */
import { useTranslations } from 'next-intl'

/** GET /api/mypage/funding/campaigns/[id]가 주는 리워드 행. 서버 응답과 1:1. */
export interface RewardRow {
  id: string
  title: string
  description: string | null
  amount: number
  total_quantity: number | null
  requires_shipping: boolean
  estimated_delivery: string | null
  image_url: string | null
  sort_order: number
  locked_at: string | null
}

export interface RewardsTabProps {
  campaignId: string
  rewards: RewardRow[]
  onChange: (rewards: RewardRow[]) => void
  editScope: 'all' | 'contentOnly' | 'none'
}

export default function RewardsTab({}: RewardsTabProps) {
  const t = useTranslations('funding')
  return <p className="text-sm text-gray-600">{t('creator.rewardsPlaceholder')}</p>
}
