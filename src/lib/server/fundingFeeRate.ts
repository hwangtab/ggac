/**
 * 캠페인 하나에 붙을 플랫폼 수수료율을 실제로 읽어 온다.
 *
 * 고르는 규칙 자체는 `@/lib/funding/feeRate`(순수)에 있고, 여기서는 그 규칙에
 * 필요한 두 가지를 DB에서 가져와 먹인다 — 지금 설정의 두 요율과, 개설자의
 * 가입 승인 상태. **읽기만 한다. 누가 부를 수 있는지는 부르는 자리가 정한다**
 * (오늘 부르는 곳은 둘 다 `requireAdmin`을 이미 통과한 뒤다).
 *
 * 같은 함수를 심사 목록(승인 전 표시)과 승인 처리(실제 각인)가 함께 쓴다.
 * 화면이 보여 준 요율과 도장이 찍히는 요율이 다르면 안 되기 때문이다.
 */

import { getProfileAuthzFields } from '@/db/queries/profiles'
import { feeRatesOf, getFundingSettings } from '@/lib/funding/settings'
import { platformFeeRateFor } from '@/lib/funding/feeRate'

export interface CampaignFeeRate {
  rate_bp: number
  is_member: boolean
}

/**
 * @param ownerUserId 캠페인의 개설자. 없거나(수기 등록) 프로필 행이 사라졌으면
 *   조합원으로 보지 않는다 — 조합원임을 확인할 길이 없는데 조합원 요율을
 *   주는 쪽으로 기울면, 확인 실패가 조용히 할인으로 바뀐다.
 */
export async function resolveCampaignFeeRate(ownerUserId: unknown): Promise<CampaignFeeRate> {
  const rates = feeRatesOf(await getFundingSettings())
  const ownerId = typeof ownerUserId === 'string' && ownerUserId.length > 0 ? ownerUserId : null
  // 프로필에서 읽는 것은 승인 상태 두 칸뿐이다(`getProfileAuthzFields`).
  // 전체 행을 끌어오면 계좌번호·실명이 함께 딸려 온다.
  const profile = ownerId ? await getProfileAuthzFields(ownerId) : null
  return platformFeeRateFor(rates, profile)
}
