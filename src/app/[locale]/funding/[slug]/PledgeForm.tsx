'use client'

/**
 * 리워드 선택·후원 폼·결제창.
 *
 * **자리만 잡아 둔 것이다.** 실제 구현(리워드 선택, 배송지, 결제 연동)은
 * 다음 과제(Task 4)에서 들어온다. 이 파일은 상세 페이지가 기대하는
 * `campaign`·`paymentEnabled`·`locale` props 계약만 지킨다.
 */

import type { CampaignDetail } from '../types'

interface Props {
  campaign: CampaignDetail
  paymentEnabled: boolean
  locale: string
}

export default function PledgeForm({ campaign }: Props) {
  return (
    <div className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
      <p>{campaign.rewards.length}개의 리워드가 준비되어 있습니다.</p>
      <p className="mt-1">결제를 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>
    </div>
  )
}
