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
 * 규칙은 둘이다.
 * ① 제출에는 리워드가 하나 이상 있어야 한다.
 * ② 정산 완료(`settle`)에는 **지급까지 끝난 정산서**가 있어야 한다. 그러지
 *    않으면 무엇을 얼마나 줬는지 아무 기록도 없이 '정산 완료' 딱지만 붙는다 —
 *    이 기능이 생기기 전의 상태가 바로 그것이었다.
 */
// 로컬 import는 `.ts`를 명시한다(`@/` 별칭 대신) — 그래야 `node --test`가 이
// 모듈을 그대로 불러올 수 있다(`src/lib/funding/notify.ts`와 같은 이유).
import { listRewards } from '../../db/queries/funding.ts'
import { getSettlementByCampaign } from '../../db/queries/fundingSettlements.ts'
import type { CampaignAction } from './transitions.ts'

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
  if (action === 'settle') {
    const settlement = await getSettlementByCampaign(campaignId)
    if (!settlement) {
      return {
        ok: false,
        message: '정산 내역을 먼저 정리해 주세요. 정산 내역 없이는 정산 완료로 바꿀 수 없습니다.',
      }
    }
    if (settlement.status !== 'paid') {
      return {
        ok: false,
        message: '아직 지급하지 않은 정산 내역입니다. 지급을 기록한 뒤 정산 완료로 바꿔 주세요.',
      }
    }
  }
  return { ok: true }
}
