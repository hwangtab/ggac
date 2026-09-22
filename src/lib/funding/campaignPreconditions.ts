/**
 * 전이 동작의 사전조건. 전이표(`transitions.ts`)는 "이 상태에서 이 동작이
 * 갈 수 있는 상태가 있는가"만 answer하고, "지금 실행해도 되는가"는 여기서
 * 판정한다.
 *
 * 조합원 라우트와 관리자 라우트가 같은 동작(예: `submit`)을 서로 다른
 * 경로로 수행할 수 있다 — 관리자가 조합원을 대신해 제출하는 것은 의도된
 * 동작이다(`transitions.ts`의 `actorFor` 참고). 그래서 사전조건을 각
 * 라우트에 따로 심으면 한쪽에서만 지켜지는 구멍이 생긴다. 두 라우트 모두
 * 전이 직전에 이 함수 하나만 물어보게 하면 새 규칙이 생겨도 여기 한 곳만
 * 고치면 된다.
 *
 * 지금은 규칙이 하나뿐이다: 제출에는 리워드가 하나 이상 있어야 한다.
 */
import { listRewards } from '@/db/queries/funding'
import type { CampaignAction } from './transitions'

export type PreconditionVerdict = { ok: true } | { ok: false; message: string }

export async function checkActionPreconditions(
  campaignId: string,
  action: CampaignAction
): Promise<PreconditionVerdict> {
  if (action === 'submit') {
    const rewards = await listRewards(campaignId)
    if (rewards.length === 0) {
      return { ok: false, message: '리워드를 하나 이상 만든 뒤 제출해 주세요.' }
    }
  }
  return { ok: true }
}
