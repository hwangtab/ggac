/**
 * 정산 쿼리 계층. 권한을 모르고, 검증된 값만 받고, 응답 키는 snake_case다.
 * 셈 자체는 `src/lib/funding/settlement.ts`(순수 함수)에 있다.
 *
 * ## 파생 값은 **언제나 여기서 다시 센다**
 *
 * 브라우저가 보낸 총 모금액·환불액·후원자 수는 받지 않는다. 정산서는 돈에
 * 대한 주장이고 브라우저는 사실의 출처가 아니다. 사람이 넣는 값은
 * 결제대행 수수료와 메모 둘뿐이며, 나머지는 저장하는 그 순간의 원장에서
 * 나온다.
 *
 * ## 읽고 나서 쓰는 자리는 전부 조건부 쓰기다
 *
 * 이 기능은 읽기-쓰기 경합에 세 번 물렸고, 확립된 해법은 "읽은 상태를 WHERE에
 * 같이 걸고 0행이면 409"다. 여기서도 같다 —
 * - 정산서를 만들 때는 캠페인이 `closed`인지 조건부 UPDATE로 잡고(그 UPDATE가
 *   트랜잭션의 쓰기 잠금을 잡는다. `applyRewardBatch`와 같은 수법),
 * - 정산서를 고칠 때는 `WHERE status = 'pending'`을 걸어 **지급이 끝난 정산서는
 *   어떤 경로로도 움직이지 않게** 한다,
 * - 지급 처리는 방금 다시 센 원장 값과 저장된 값이 같을 때만 통과시킨다.
 */

import { and, eq, isNotNull, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { fundingCampaigns, fundingPledges, fundingSettlements } from '../schema/index.ts'
import {
  computeSettlementAmounts,
  isBasisStale,
  netAmount,
  type SettlementAmounts,
  type SettlementBasis,
} from '../../lib/funding/settlement.ts'

import { retryOnLockContention, toIso, toSnakeCase } from './_helpers.ts'

type Row = Record<string, unknown>

function rowToSettlement(row: Row): Row {
  const snake = toSnakeCase(row)
  snake.paid_out_at = toIso(row.paidOutAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

/** 트랜잭션 핸들과 모듈 커넥션을 같은 자리에서 쓰기 위한 별명. */
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * 결제가 실제로 잡힌 적 있는 후원인가.
 *
 * `paid`와 `refunded`는 분명하다. `canceled`는 둘을 겸한다 — 결제 한 번 없이
 * 만료·취소된 선점도 `canceled`이고, 환불이 진행 중인(토스 취소를 부르기 직전
 * 선점해 둔) 결제 건도 `canceled`다. 뒤쪽만 세려면 결제가 붙었는지를 봐야
 * 한다(`revertPledgeCancel`이 같은 조건으로 되돌린다).
 */
function capturedCondition() {
  return or(
    eq(fundingPledges.status, 'paid'),
    eq(fundingPledges.status, 'refunded'),
    and(eq(fundingPledges.status, 'canceled'), isNotNull(fundingPledges.paymentId))
  )
}

/**
 * 원장에서 세 값을 센다. **정산서를 쓰는 그 순간에** 부른다.
 *
 * - `gross_amount` — 결제가 잡힌 적 있는 모든 후원의 합. 나중에 돌려준 돈도 센다.
 * - `refund_amount` — 그중 `paid`로 남지 않은 것. 환불이 끝났거나 나가는 중이다.
 *   나가는 중인 건을 환불로 세는 쪽을 고른다 — 아직 안 나갔다고 보면 지급액을
 *   실제보다 크게 잡게 되고, 그 오차는 조합이 아니라 창작자에게 잘못 나간 돈이 된다.
 * - `backer_count` — `paid`로 남은 건수. 공개 화면의 후원자 수와 같은 셈이다.
 */
export async function computeSettlementBasis(
  campaignId: string,
  executor: Executor = db as unknown as Executor
): Promise<SettlementBasis> {
  const [row] = await executor
    .select({
      gross: sql<number>`COALESCE(SUM(${fundingPledges.totalAmount}), 0)`,
      refund: sql<number>`COALESCE(SUM(CASE WHEN ${fundingPledges.status} = 'paid' THEN 0 ELSE ${fundingPledges.totalAmount} END), 0)`,
      backers: sql<number>`COALESCE(SUM(CASE WHEN ${fundingPledges.status} = 'paid' THEN 1 ELSE 0 END), 0)`,
    })
    .from(fundingPledges)
    .where(and(eq(fundingPledges.campaignId, campaignId), capturedCondition()))
  return {
    gross_amount: Number(row?.gross ?? 0),
    refund_amount: Number(row?.refund ?? 0),
    backer_count: Number(row?.backers ?? 0),
  }
}

export async function getSettlementByCampaign(campaignId: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(fundingSettlements)
    .where(eq(fundingSettlements.campaignId, campaignId))
    .limit(1)
  return rows[0] ? rowToSettlement(rows[0] as Row) : null
}

/** 저장된 정산서에서 근거 세 값만 뽑는다. 대조에 쓴다. */
export function basisOf(settlement: Row): SettlementBasis {
  return {
    gross_amount: Number(settlement.gross_amount ?? 0),
    refund_amount: Number(settlement.refund_amount ?? 0),
    backer_count: Number(settlement.backer_count ?? 0),
  }
}

/**
 * 저장된 정산서가 지금 원장과 어긋나는가. 지급이 끝난 건은 대조하지 않는다
 * (`isBasisStale` 주석 참고).
 */
export async function isSettlementStale(settlement: Row): Promise<boolean> {
  if (settlement.status === 'paid') return false
  const current = await computeSettlementBasis(String(settlement.campaign_id))
  return isBasisStale(basisOf(settlement), current)
}

export type SettlementWriteResult =
  | {
      ok: true
      settlement: Row
      created: boolean
      amounts: SettlementAmounts
      /**
       * 이 쓰기 **직전**의 정산 금액 한 벌. 없던 정산서면 null.
       *
       * 두 가지 일을 한다.
       *
       * ① 호출부가 "개설자에게 다시 알릴 일인가"를 `payout_amount`로 판정한다.
       *    트랜잭션 밖에서 따로 읽으면 두 관리자가 동시에 정리할 때 둘 다
       *    "바뀌었다"로 읽어 같은 금액을 두 번 알린다 — 그래서 같은 트랜잭션
       *    안에서, 쓰기 잠금을 잡은 뒤에 읽은 값을 돌려준다.
       *
       * ② **덮어쓰기 전의 숫자를 남길 유일한 기회다.** 정산서는 캠페인마다 한
       *    행이라 다시 정리하면 앞의 값이 그 자리에서 사라진다. 조합원에게 줄
       *    돈에 대한 기록이므로 "전에는 뭐라고 적혀 있었나"가 남아야 하고,
       *    호출부가 이 값을 활동 기록에 적는다. 표를 새로 만들지 않는다 —
       *    활동 기록이 이미 그 일을 하는 자리다.
       */
      previous_amounts: SettlementAmounts | null
    }
  | { ok: false; reason: 'campaign_not_closed' }
  | { ok: false; reason: 'already_paid' }
  | { ok: false; reason: 'compute'; message: string }

/** 트랜잭션을 되감기 위한 내부 신호. 바깥에서 결과로 바꿔 돌려준다. */
class SettlementAbort extends Error {
  result: SettlementWriteResult
  constructor(result: SettlementWriteResult) {
    super('settlement aborted')
    this.result = result
  }
}

/**
 * 정산서를 만들거나 다시 정리한다.
 *
 * 캠페인이 `closed`일 때만 된다 — 아직 후원을 받는 캠페인에는 최종 숫자라는
 * 것이 없고, `settled`는 이미 끝난 일이다. 상태 확인은 트랜잭션 맨 앞의 조건부
 * UPDATE로 해서 그 자리에서 쓰기 잠금을 잡는다(`applyRewardBatch`와 같은 수법).
 *
 * 파생 값은 **이 트랜잭션 안에서** 다시 센다. 바깥에서 세어 넘기면 세는 순간과
 * 쓰는 순간 사이에 환불이 끼어들 수 있다.
 */
export async function prepareSettlement(input: {
  campaign_id: string
  platform_fee_rate_bp: number
  pg_fee_amount: number
  memo?: string | null
}): Promise<SettlementWriteResult> {
  try {
    return await retryOnLockContention(() =>
      db.transaction(async tx => {
        const held = await tx
          .update(fundingCampaigns)
          .set({ status: 'closed' })
          .where(
            and(eq(fundingCampaigns.id, input.campaign_id), eq(fundingCampaigns.status, 'closed'))
          )
          .returning({ id: fundingCampaigns.id })
        if (held.length === 0)
          throw new SettlementAbort({ ok: false, reason: 'campaign_not_closed' })

        const existing = await tx
          .select()
          .from(fundingSettlements)
          .where(eq(fundingSettlements.campaignId, input.campaign_id))
          .limit(1)
        if (existing[0]?.status === 'paid') {
          throw new SettlementAbort({ ok: false, reason: 'already_paid' })
        }

        const basis = await computeSettlementBasis(input.campaign_id, tx)
        const computed = computeSettlementAmounts({
          basis,
          platform_fee_rate_bp: input.platform_fee_rate_bp,
          pg_fee_amount: input.pg_fee_amount,
        })
        if (computed.ok === false) {
          throw new SettlementAbort({ ok: false, reason: 'compute', message: computed.message })
        }
        const values = {
          ...computed.amounts,
          memo: input.memo ?? null,
        }

        if (existing[0]) {
          // 지급이 끝난 정산서는 위에서 걸렀지만, 마지막 방어선은 DB 조건이다 —
          // 확인과 이 쓰기 사이에 다른 관리자가 지급 처리를 끝낼 수 있다.
          const [updated] = await tx
            .update(fundingSettlements)
            .set({
              grossAmount: values.gross_amount,
              refundAmount: values.refund_amount,
              backerCount: values.backer_count,
              pgFeeAmount: values.pg_fee_amount,
              platformFeeAmount: values.platform_fee_amount,
              payoutAmount: values.payout_amount,
              memo: values.memo,
            })
            .where(
              and(
                eq(fundingSettlements.campaignId, input.campaign_id),
                eq(fundingSettlements.status, 'pending')
              )
            )
            .returning()
          if (!updated) throw new SettlementAbort({ ok: false, reason: 'already_paid' })
          return {
            ok: true,
            created: false,
            settlement: rowToSettlement(updated as Row),
            amounts: computed.amounts,
            previous_amounts: {
              gross_amount: Number(existing[0].grossAmount ?? 0),
              refund_amount: Number(existing[0].refundAmount ?? 0),
              backer_count: Number(existing[0].backerCount ?? 0),
              pg_fee_amount: Number(existing[0].pgFeeAmount ?? 0),
              platform_fee_amount: Number(existing[0].platformFeeAmount ?? 0),
              payout_amount: Number(existing[0].payoutAmount ?? 0),
            },
          } as SettlementWriteResult
        }

        const [created] = await tx
          .insert(fundingSettlements)
          .values({
            campaignId: input.campaign_id,
            grossAmount: values.gross_amount,
            refundAmount: values.refund_amount,
            backerCount: values.backer_count,
            pgFeeAmount: values.pg_fee_amount,
            platformFeeAmount: values.platform_fee_amount,
            payoutAmount: values.payout_amount,
            status: 'pending',
            memo: values.memo,
          })
          .returning()
        return {
          ok: true,
          created: true,
          settlement: rowToSettlement(created as Row),
          amounts: computed.amounts,
          previous_amounts: null,
        } as SettlementWriteResult
      })
    )
  } catch (error) {
    if (error instanceof SettlementAbort) return error.result
    throw error
  }
}

/** 지급 트랜잭션을 되감기 위한 내부 신호. `SettlementAbort`와 같은 수법이다. */
class SettlementPayAbort extends Error {
  result: SettlementPayResult
  constructor(result: SettlementPayResult) {
    super('settlement payout aborted')
    this.result = result
  }
}

export type SettlementPayResult =
  | { ok: true; settlement: Row }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_paid' }
  | { ok: false; reason: 'stale'; current: SettlementBasis }

/**
 * 지급을 기록한다 — 조합이 돈을 실제로 보냈다는 뜻이고, 그 순간부터 숫자는
 * 움직이지 않는다.
 *
 * **다시 세는 것과 도장을 찍는 것이 한 트랜잭션이어야 한다.** 둘을 따로 두면
 * 그 사이에 커밋되는 환불을 볼 수 없다 — 금액 조건을 WHERE에 걸어도 그 값은
 * 방금 읽은 값과 이미 같으므로 아무것도 걸러내지 못한다. 그 창으로 들어온
 * 환불 한 건은 환불 전 숫자를 `paid`로 굳히고, 굳은 뒤에는 `isSettlementStale`이
 * 영원히 false라(지급한 정산서는 대조하지 않는다) 아무도 눈치채지 못한다.
 * 돈은 손으로 이미 보냈으니 잘못 나가지는 않지만, **조합이 얼마를 줬어야
 * 했는지에 대한 기록이 한 건만큼 틀린 채로 남는다.**
 *
 * 그래서 트랜잭션의 **첫 문장을 쓰기로** 둔다 — libSQL은 첫 쓰기에서 즉시
 * 쓰기 트랜잭션을 열어 잠금을 잡는다(`prepareSettlement`·`applyRewardBatch`가
 * 이미 기대고 있는 성질이다). 그 뒤에 세는 값은 커밋 시점까지 움직이지 않는다.
 *
 * 방어선은 그대로 둘이다.
 * ① `WHERE status = 'pending'` — 두 번 누르거나 두 사람이 동시에 눌러도 한 번만
 *    통과한다. 이미 `paid`면 0행이고 호출부는 409로 답한다.
 * ② `WHERE gross/refund/backer = 방금 다시 센 값` — 잠금이 막아 주는 것과 별개로
 *    남겨 둔다. 한쪽을 지워도 다른 한쪽이 잡는다.
 */
export async function markSettlementPaid(campaignId: string): Promise<SettlementPayResult> {
  try {
    return await retryOnLockContention(() =>
      db.transaction(async tx => {
        // 첫 문장이 쓰기다 — 값은 그대로 두고 조건만 본다. 이 문장이 통과하는
        // 순간부터 이 캠페인의 원장은 커밋까지 움직이지 않는다.
        const [held] = await tx
          .update(fundingSettlements)
          .set({ status: 'pending' })
          .where(
            and(
              eq(fundingSettlements.campaignId, campaignId),
              eq(fundingSettlements.status, 'pending')
            )
          )
          .returning()
        if (!held) {
          const existing = await tx
            .select({ status: fundingSettlements.status })
            .from(fundingSettlements)
            .where(eq(fundingSettlements.campaignId, campaignId))
            .limit(1)
          throw new SettlementPayAbort({
            ok: false,
            reason: existing[0] ? 'already_paid' : 'not_found',
          })
        }

        const stored = rowToSettlement(held as Row)
        const current = await computeSettlementBasis(campaignId, tx)
        if (isBasisStale(basisOf(stored), current)) {
          throw new SettlementPayAbort({ ok: false, reason: 'stale', current })
        }

        const [row] = await tx
          .update(fundingSettlements)
          .set({ status: 'paid', paidOutAt: new Date() })
          .where(
            and(
              eq(fundingSettlements.campaignId, campaignId),
              eq(fundingSettlements.status, 'pending'),
              eq(fundingSettlements.grossAmount, current.gross_amount),
              eq(fundingSettlements.refundAmount, current.refund_amount),
              eq(fundingSettlements.backerCount, current.backer_count)
            )
          )
          .returning()
        if (!row) throw new SettlementPayAbort({ ok: false, reason: 'stale', current })
        return { ok: true, settlement: rowToSettlement(row as Row) } as SettlementPayResult
      })
    )
  } catch (error) {
    if (error instanceof SettlementPayAbort) return error.result
    throw error
  }
}

/** 화면이 함께 보여 주는 실 모금액. 저장 값에서 뺄셈 한 번이다. */
export function settlementNetAmount(settlement: Row): number {
  return netAmount(basisOf(settlement))
}
