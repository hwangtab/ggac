/**
 * 후원 쿼리 계층. 티켓 예매(`ticketing.ts`)와 같은 뼈대 — 재고를 먼저 잡고,
 * 승인이 끝나면 확정하며, 주문번호(`order_id`)가 결제와 후원을 잇는 유일한 고리다.
 */

import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { fundingCampaigns, fundingPledges, fundingRewards, payments } from '../schema/index.ts'
import { computePledgeTotal } from '../../lib/funding/amounts.ts'
import { generatePledgeCode } from '../../lib/funding/pledgeCode.ts'

import { retryOnLockContention, toIso, toSnakeCase } from './_helpers.ts'

type Row = Record<string, unknown>

export const DEFAULT_HOLD_MINUTES = 10

/**
 * 한 신원이 **한 리워드에** 동시에 들고 있을 수 있는 결제 대기 선점의 수.
 *
 * 선점은 돈 없이 재고를 줄인다. 상한이 없으면 아무나 한정 리워드를 통째로
 * 매진 상태로 만들어 두고, 만료되면 다시 채울 수 있다(요청 빈도만 막는
 * 레이트리밋은 분산 환경에서 인스턴스별 메모리로 떨어질 수 있어 이 경계를
 * 지키지 못한다). 그래서 "얼마나 자주 물어보는가"가 아니라 **"동시에 얼마나
 * 쥘 수 있는가"**를 DB에서, 선점 트랜잭션 안에서 막는다.
 *
 * 3인 이유: 같은 음반·같은 도록을 친구 셋에게 보내는 후원은 조합 프로젝트에서
 * 예외가 아니다. 후원 한 건에 배송지는 하나뿐이라 세 사람에게 보내려면 후원도
 * 세 건이어야 한다. 세 건까지는 결제 순서를 신경 쓰지 않고 그대로 되고, 네
 * 번째부터 "먼저 결제를 마치라"는 안내를 받는다 — 10분 안에 결제 네 건을
 * 시작해 하나도 끝내지 않은 상태다.
 *
 * 이 상한이 막는 것과 막지 못하는 것을 분명히 해 둔다. **한 신원**이 재고를
 * 쥔 채 결제를 미루는 것은 막는다. 이메일 별칭을 갈아 가며 도는 공격은 **막지
 * 못한다** — 별칭마다 새 신원이기 때문이다. 그쪽의 방어선은 선점이 10분 만에
 * 스스로 풀린다는 것과 라우트의 빈도 제한이지 이 값이 아니다. 그래서 이 값은
 * 공격자가 아니라 **진짜 후원자에 맞춰** 넉넉히 잡는다.
 */
export const MAX_HOLDS_PER_REWARD = 3

/**
 * 한 신원이 **한 프로젝트에** 동시에 들고 있을 수 있는 결제 대기 선점의 수.
 *
 * 리워드별 상한만으로는 리워드를 옮겨 가며 쌓는 것을 막지 못해 프로젝트
 * 단위로 한 번 더 묶는다. 5인 이유: 한 프로젝트에서 서로 다른 리워드를
 * 견주어 보다가 결제를 미룬 후원자가 실제로 만들 수 있는 선점 수가 이
 * 정도이고, 같은 리워드 세 건(위 상한)에 다른 리워드 두 건을 더해도 걸리지
 * 않는다.
 *
 * **프로젝트별로 센다.** 전체로 세면 프로젝트 넷을 견주어 보다 셋을 그냥 닫은
 * 조합원이 네 번째 프로젝트에서 "먼저 결제를 마치라"는 말을 듣는다 — 그
 * 사람이 할 수 있는 일이 아무것도 없는 안내다.
 */
export const MAX_OUTSTANDING_HOLDS = 5

export class RewardSoldOutError extends Error {
  remaining: number
  constructor(remaining: number) {
    super(
      remaining > 0 ? `남은 수량이 ${remaining}개뿐입니다.` : '준비된 수량이 모두 소진되었습니다.'
    )
    this.name = 'RewardSoldOutError'
    this.remaining = remaining
  }
}

/**
 * 한 신원이 이미 결제 대기 선점을 상한까지 들고 있을 때.
 * 매진이 아니라 "먼저 하던 결제를 끝내라"는 뜻이라 문구가 다르다.
 *
 * 리워드 상한과 프로젝트 상한은 후원자가 할 수 있는 일이 다르다 — 앞쪽은
 * 수량을 늘려 한 번에 후원하는 길이 남아 있고, 뒤쪽은 없다. 그래서 문장을
 * 나눈다.
 */
export class TooManyPendingHoldsError extends Error {
  scope: 'reward' | 'campaign'
  limit: number
  constructor(scope: 'reward' | 'campaign', limit: number, holdMinutes = DEFAULT_HOLD_MINUTES) {
    super(
      scope === 'reward'
        ? `이 리워드에 아직 결제가 끝나지 않은 후원이 ${limit}건 있습니다. 먼저 결제를 마치시거나, 결제 대기 시간 ${holdMinutes}분이 지난 뒤에 다시 후원해 주세요. 같은 리워드를 여러 개 받으시려면 후원할 때 수량을 늘리셔도 됩니다.`
        : `이 프로젝트에 아직 결제가 끝나지 않은 후원이 ${limit}건 있습니다. 먼저 결제를 마치시거나, 결제 대기 시간 ${holdMinutes}분이 지난 뒤에 다시 후원해 주세요.`
    )
    this.name = 'TooManyPendingHoldsError'
    this.scope = scope
    this.limit = limit
  }
}

/**
 * 승인은 끝났는데 확정할 자리가 없을 때 — 선점이 만료된 사이에 마지막 수량이
 * 다른 후원자에게 돌아갔거나(`sold_out`), 프로젝트가 마감됐다(`campaign_closed`).
 *
 * 던지면 확정 트랜잭션이 통째로 되감긴다(후원도 원장도 그대로). 부르는 쪽은
 * **반드시 결제를 환불하고** 후원자에게 사실대로 알려야 한다 — 돈만 받고
 * "완료"라고 답하는 것이 여기서 일어날 수 있는 최악이다.
 */
export class PledgeStockUnavailableError extends Error {
  reason: 'sold_out' | 'campaign_closed'
  constructor(reason: 'sold_out' | 'campaign_closed') {
    super(
      reason === 'campaign_closed'
        ? '프로젝트가 마감되어 후원을 확정할 수 없습니다.'
        : '남은 수량이 없어 후원을 확정할 수 없습니다.'
    )
    this.name = 'PledgeStockUnavailableError'
    this.reason = reason
  }
}

/**
 * 이 프로젝트의 환불은 전부 전액 환불이다. 부분 환불을 모델링하려면 후원에
 * "일부만 환불됨" 상태와 남은 금액이 따로 있어야 하는데 그 상태가 아직
 * 없다 — 조용히 절반만 처리하고 `refunded`로 넘겨버리면 원장의 누적
 * 취소액이 실제보다 적게 남고(다음 부분 환불이 매칭할 상태를 잃는다), 재고도
 * 전액 환불처럼 통째로 풀리고, 후원자는 실제로는 일부만 돌려받았는데
 * "환불 완료"로 보인다. 지원하지 못하는 입력은 조용히 잘못 처리하는 것보다
 * 시끄럽게 거부하는 편이 낫다. 제대로 된 부분 환불은 이후 관리자 환불
 * 화면과 함께 들어온다.
 */
export class PartialRefundUnsupportedError extends Error {
  totalAmount: number
  canceledAmount: number
  constructor(totalAmount: number, canceledAmount: number) {
    super(
      `부분 환불은 아직 지원하지 않습니다. 후원 금액 ${totalAmount}원 중 ${canceledAmount}원만 취소 요청됐습니다.`
    )
    this.name = 'PartialRefundUnsupportedError'
    this.totalAmount = totalAmount
    this.canceledAmount = canceledAmount
  }
}

const DATE_KEYS = [
  'holdExpiresAt',
  'paidAt',
  'canceledAt',
  'refundedAt',
  'termsAgreedAt',
  'privacyAgreedAt',
  'createdAt',
  'updatedAt',
] as const

function rowToPledge(row: Row): Row {
  const snake = toSnakeCase(row)
  for (const key of DATE_KEYS) {
    snake[key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)] = toIso(row[key] as Date | null)
  }
  return snake
}

/**
 * 재고를 차지하는 후원: paid이거나 아직 만료되지 않은 pending.
 *
 * `isNull(holdExpiresAt)` 가지는 오늘은 닿지 않는다 — `holdPledgeOnce`가
 * 선점을 만들 때 항상 만료시각을 함께 새기므로 만료시각 없는 pending 행은
 * 생기지 않는다. 생겼다면 만료 스윕(`listExpiredHolds`)이 절대 고르지
 * 못해 영구히 재고를 차지하는 채로 남는다 — 티켓 예매 모듈에서 그대로
 * 물려받은 모양이다.
 */
function occupyingCondition(now: Date) {
  return or(
    eq(fundingPledges.status, 'paid'),
    and(
      eq(fundingPledges.status, 'pending'),
      or(isNull(fundingPledges.holdExpiresAt), gt(fundingPledges.holdExpiresAt, now))
    )
  )
}

/** 트랜잭션 핸들과 모듈 커넥션을 같은 자리에서 쓰기 위한 별명. */
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * 재고를 차지하는 수량의 합.
 *
 * **선점을 잡을 때와 확정할 때가 같은 셈을 써야 한다.** 둘이 어긋나면 선점은
 * 매진이라 말하는데 확정은 자리가 있다고 답하거나(초과 판매), 그 반대가 된다.
 * 그래서 두 자리 모두 이 함수만 부른다 — `excludePledgeId`는 확정하려는
 * 자기 자신을 셈에서 빼기 위한 것이다.
 */
async function sumOccupyingQuantity(
  executor: Executor,
  rewardId: string,
  now: Date,
  excludePledgeId?: string
): Promise<number> {
  const conditions = [eq(fundingPledges.rewardId, rewardId), occupyingCondition(now)]
  if (excludePledgeId) conditions.push(ne(fundingPledges.id, excludePledgeId))
  const [taken] = await executor
    .select({ total: sql<number>`COALESCE(SUM(${fundingPledges.quantity}), 0)` })
    .from(fundingPledges)
    .where(and(...conditions))
  return Number(taken?.total ?? 0)
}

export async function getRemainingQuantity(
  rewardId: string,
  now: Date = new Date()
): Promise<number | null> {
  const [reward] = await db
    .select({ total: fundingRewards.totalQuantity })
    .from(fundingRewards)
    .where(eq(fundingRewards.id, rewardId))
    .limit(1)
  if (!reward || reward.total === null) return null
  const taken = await sumOccupyingQuantity(db as unknown as Executor, rewardId, now)
  return Math.max(0, Number(reward.total) - taken)
}

/**
 * 선점의 임자를 무엇으로 볼 것인가 — 상한을 셀 때 "같은 사람"의 뜻이다.
 *
 * 로그인한 조합원은 계정(`user_id`), 비회원은 소문자로 맞춘 이메일이다 —
 * 표에 이미 있는 값이고, 비회원 후원이 기본 경로인 이 화면에서 요청자가
 * 스스로 바꿀 수 있는 것 중 가장 무겁다(주소 한 줄보다 바꾸기 번거롭다).
 *
 * 회원 선점과 비회원 선점은 섞지 않는다. 섞으면 남의 이메일을 적어 낸
 * 비회원이 로그인한 조합원의 상한을 대신 채워 그 조합원의 후원을 막을 수
 * 있다.
 */
function ownHoldCondition(userId: string | null, email: string) {
  return userId
    ? and(eq(fundingPledges.userId, userId), eq(fundingPledges.status, 'pending'))
    : and(
        isNull(fundingPledges.userId),
        sql`lower(${fundingPledges.backerEmail}) = lower(${email})`,
        eq(fundingPledges.status, 'pending')
      )
}

export interface HoldPledgeInput {
  order_id: string
  campaign_id: string
  reward_id: string
  user_id: string | null
  quantity: number
  additional_amount: number
  backer_name: string
  backer_email: string
  backer_phone?: string | null
  is_anonymous?: boolean
  supporter_message?: string | null
  message_public?: boolean
  shipping?: {
    name: string
    phone: string
    postcode: string
    address1: string
    address2?: string | null
    memo?: string | null
  } | null
  terms_version?: string | null
  hold_minutes?: number
}

/** 락 경합만 재시도한다. 매진과 상한은 다시 해도 같다. */
export async function holdPledge(input: HoldPledgeInput): Promise<Row> {
  return retryOnLockContention(
    () => holdPledgeOnce(input),
    error => error instanceof RewardSoldOutError || error instanceof TooManyPendingHoldsError
  )
}

async function holdPledgeOnce(input: HoldPledgeInput): Promise<Row> {
  const now = new Date()
  const holdMinutes = input.hold_minutes ?? DEFAULT_HOLD_MINUTES

  return db.transaction(async tx => {
    const [reward] = await tx
      .select({
        title: fundingRewards.title,
        amount: fundingRewards.amount,
        total: fundingRewards.totalQuantity,
        campaignId: fundingRewards.campaignId,
      })
      .from(fundingRewards)
      .where(eq(fundingRewards.id, input.reward_id))
      .limit(1)
    if (!reward || reward.campaignId !== input.campaign_id)
      throw new Error('리워드를 찾을 수 없습니다.')

    const own = ownHoldCondition(input.user_id, input.backer_email)

    // 선점은 **갈아 끼우지 않는다.** 한때는 같은 리워드의 자기 선점을
    // `expired`로 바꾸고 그 자리에 새 선점을 넣었다. 그 한 줄이 돈을 잃는
    // 길이었다: 토스는 승인했는데 우리 쪽 확정이 유실되면 확정 라우트가 503
    // "결제 결과를 확인하는 중입니다"로 답하고, 그 말을 들은 후원자가 가장
    // 자연스럽게 하는 일이 다시 후원하기다. 그 두 번째 선점이 첫 번째를
    // `expired`로 덮는 순간, 만료 스윕(`listExpiredHolds`는 `pending`만
    // 고른다)의 눈에서 그 후원이 영영 사라진다 — 돈은 빠져나갔는데 아무도
    // 환불하지 않고, 아무도 보지 않는다.
    //
    // 그래서 쌓이는 것만 막고 지우지는 않는다. 한 신원이 **동시에** 들 수
    // 있는 선점 수에 상한을 두면 안티스태킹은 그대로 남고, 스윕은 모든
    // pending 행을 계속 본다.
    //
    // 세는 것도 막는 것도 이 트랜잭션 안이다. libSQL 드라이버는 트랜잭션을
    // `BEGIN IMMEDIATE`로 연다(모드 기본값 `write`) — 첫 문장부터 쓰기 잠금을
    // 쥐므로 여기서 센 값과 아래 INSERT 사이에 다른 선점이 끼어들 수 없다.
    // 겹친 요청은 `SQLITE_BUSY`가 되어 `holdPledge`의 재시도가 받는다.
    const [perReward] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(fundingPledges)
      .where(
        and(
          eq(fundingPledges.rewardId, input.reward_id),
          own,
          gt(fundingPledges.holdExpiresAt, now)
        )
      )
    if (Number(perReward?.count ?? 0) >= MAX_HOLDS_PER_REWARD) {
      throw new TooManyPendingHoldsError('reward', MAX_HOLDS_PER_REWARD, holdMinutes)
    }

    // 리워드를 옮겨 가며 쌓는 것까지 막으려면 프로젝트 단위로 한 번 더 묶어야
    // 한다. 프로젝트별로 세므로 다른 프로젝트를 견주어 보던 선점은 걸리지 않는다.
    const [perCampaign] = await tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(fundingPledges)
      .where(
        and(
          eq(fundingPledges.campaignId, input.campaign_id),
          own,
          gt(fundingPledges.holdExpiresAt, now)
        )
      )
    if (Number(perCampaign?.count ?? 0) >= MAX_OUTSTANDING_HOLDS) {
      throw new TooManyPendingHoldsError('campaign', MAX_OUTSTANDING_HOLDS, holdMinutes)
    }

    if (reward.total !== null) {
      const taken = await sumOccupyingQuantity(tx, input.reward_id, now)
      const remaining = Math.max(0, Number(reward.total) - taken)
      if (input.quantity > remaining) throw new RewardSoldOutError(remaining)
    }

    const totalAmount = computePledgeTotal({
      unitAmount: Number(reward.amount),
      quantity: input.quantity,
      additionalAmount: input.additional_amount,
    })

    const rows = await tx
      .insert(fundingPledges)
      .values({
        pledgeCode: generatePledgeCode(now),
        campaignId: input.campaign_id,
        rewardId: input.reward_id,
        userId: input.user_id,
        orderId: input.order_id,
        backerName: input.backer_name,
        backerEmail: input.backer_email,
        backerPhone: input.backer_phone ?? null,
        rewardTitle: reward.title,
        unitAmount: Number(reward.amount),
        quantity: input.quantity,
        additionalAmount: input.additional_amount,
        totalAmount,
        status: 'pending',
        holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        isAnonymous: input.is_anonymous ?? false,
        supporterMessage: input.supporter_message ?? null,
        messagePublic: input.message_public ?? false,
        shippingName: input.shipping?.name ?? null,
        shippingPhone: input.shipping?.phone ?? null,
        shippingPostcode: input.shipping?.postcode ?? null,
        shippingAddress1: input.shipping?.address1 ?? null,
        shippingAddress2: input.shipping?.address2 ?? null,
        shippingMemo: input.shipping?.memo ?? null,
        termsVersion: input.terms_version ?? null,
        termsAgreedAt: now,
        privacyAgreedAt: now,
      })
      .returning()
    return rowToPledge(rows[0] as Row)
  })
}

/**
 * 결제 확정과 후원 확정, 리워드 잠금을 한 트랜잭션으로.
 * `order_id`가 WHERE에 들어가는 것이 핵심 — 짝이 안 맞으면 0행이고 결제도 안 바뀐다.
 *
 * **자리가 있는지도 여기서 본다.** 선점이 만료되기 직전에 승인 요청을 보내면
 * 라우트의 만료 검사는 통과하고, 그다음 토스 승인이 오가는 몇 초 사이에 선점은
 * 실제로 만료된다 — 그 틈에 다른 사람이 마지막 수량을 잡아 결제까지 마칠 수
 * 있다. 라우트에서 아무리 앞뒤로 확인해도 이 틈은 닫히지 않으므로, 확정이
 * 일어나는 **바로 이 트랜잭션 안에서** 수량과 캠페인 상태를 다시 본다.
 * 자리가 없으면 `PledgeStockUnavailableError`를 던지고 아무것도 쓰지 않는다 —
 * 부르는 쪽이 환불하고 사실대로 알려야 한다.
 */
export interface FinalizePledgeInput {
  orderId: string
  pledgeId: string
  paymentKey: string
  method: string | null
  approvedAt: Date
  raw: unknown
}

/**
 * 락 경합만 재시도한다(`holdPledge`와 같은 규칙). 확정은 선점·다른 확정과
 * 같은 행들을 두고 겨루므로 경합 자체는 일상이다 — 여기서 물러나면 이미
 * 승인된 결제가 "확인 중"으로 밀려나 사람 손을 부른다. 자리가 없다는 판정
 * (`PledgeStockUnavailableError`)은 다시 해도 같으므로 그대로 올린다.
 */
export async function finalizePledgePayment(input: FinalizePledgeInput): Promise<Row | null> {
  return retryOnLockContention(
    () => finalizePledgePaymentOnce(input),
    error => error instanceof PledgeStockUnavailableError
  )
}

async function finalizePledgePaymentOnce(input: FinalizePledgeInput): Promise<Row | null> {
  const now = new Date()
  return db.transaction(async tx => {
    const [payment] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.orderId, input.orderId))
      .limit(1)
    if (!payment) return null

    const [target] = await tx
      .select()
      .from(fundingPledges)
      .where(and(eq(fundingPledges.id, input.pledgeId), eq(fundingPledges.orderId, input.orderId)))
      .limit(1)
    if (!target) return null
    // 더블클릭·재시도. 같은 주문으로 이미 확정됐으면 성공으로 답한다 —
    // 아래 재고·마감 검사보다 **먼저** 본다. 이미 확정된 후원을 나중에
    // 마감됐다는 이유로 실패로 답하면, 멀쩡히 끝난 결제를 환불하게 된다.
    if (target.status === 'paid') return rowToPledge(target as Row)
    if (target.status !== 'pending') return null

    // 캠페인이 마감·정산됐으면 재고 계산의 전제 자체가 없다. 크론의 승격
    // 경로는 승인 10분 뒤에도 올 수 있어 이 검사가 특히 필요하다.
    const [campaign] = await tx
      .select({ status: fundingCampaigns.status })
      .from(fundingCampaigns)
      .where(eq(fundingCampaigns.id, target.campaignId))
      .limit(1)
    if (!campaign || campaign.status !== 'active') {
      throw new PledgeStockUnavailableError('campaign_closed')
    }

    const [reward] = await tx
      .select({ total: fundingRewards.totalQuantity })
      .from(fundingRewards)
      .where(eq(fundingRewards.id, target.rewardId))
      .limit(1)
    if (reward && reward.total !== null) {
      // 선점을 잡을 때와 같은 셈(`sumOccupyingQuantity`)이다. 자기 자신은
      // 빼고 센다 — 아직 pending이라 그대로 두면 자기 수량을 두 번 센다.
      const taken = await sumOccupyingQuantity(tx, target.rewardId, now, target.id)
      if (taken + Number(target.quantity) > Number(reward.total)) {
        throw new PledgeStockUnavailableError('sold_out')
      }
    }

    const [confirmed] = await tx
      .update(fundingPledges)
      .set({ status: 'paid', paymentId: payment.id, paidAt: input.approvedAt, holdExpiresAt: null })
      .where(
        and(
          eq(fundingPledges.id, input.pledgeId),
          eq(fundingPledges.orderId, input.orderId),
          eq(fundingPledges.status, 'pending')
        )
      )
      .returning()
    // 여기서 0행이면 같은 후원을 두 요청이 동시에 확정하려 한 것이다. 이긴
    // 쪽이 이미 paid로 바꿨으므로 그 행을 읽어 성공으로 답한다.
    if (!confirmed) {
      const [already] = await tx
        .select()
        .from(fundingPledges)
        .where(
          and(
            eq(fundingPledges.id, input.pledgeId),
            eq(fundingPledges.orderId, input.orderId),
            eq(fundingPledges.status, 'paid')
          )
        )
        .limit(1)
      return already ? rowToPledge(already as Row) : null
    }

    await tx
      .update(payments)
      .set({
        status: 'done',
        paymentKey: input.paymentKey,
        method: input.method,
        approvedAt: input.approvedAt,
        rawResponse: input.raw,
        failureCode: null,
        failureMessage: null,
      })
      .where(eq(payments.id, payment.id))

    // 의도적으로 인라인이다: 이 트랜잭션 핸들(tx) 위에서 실행돼야 하므로
    // 모듈 수준 커넥션을 닫는 별도 헬퍼로 뺄 수 없다 — 뺐다면 이 확정과
    // 다른 트랜잭션이었을 커밋 시점을 가진다.
    await tx
      .update(fundingRewards)
      .set({ lockedAt: input.approvedAt })
      .where(and(eq(fundingRewards.id, confirmed.rewardId), isNull(fundingRewards.lockedAt)))

    return rowToPledge(confirmed as Row)
  })
}

/** 취소 선점: `paid → canceled`. 0행이면 이미 다른 요청이 잡았거나 취소 불가 상태다. */
export async function claimPledgeForCancel(
  pledgeId: string,
  options: { requireFulfillmentNone?: boolean }
): Promise<Row | null> {
  const conditions = [eq(fundingPledges.id, pledgeId), eq(fundingPledges.status, 'paid')]
  if (options.requireFulfillmentNone) conditions.push(eq(fundingPledges.fulfillmentStatus, 'none'))
  const [row] = await db
    .update(fundingPledges)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(and(...conditions))
    .returning()
  return row ? rowToPledge(row as Row) : null
}

/**
 * 취소 선점을 되돌린다(토스 거절 시). `canceled`이기만 하면 되돌리는 것으로는
 * 부족하다 — `cancelPendingPledge`도 같은 `canceled` 상태를 만드는데, 그건
 * `pending`에서 결제 한 번 없이 온 것이다. 그 id로 이 함수를 부르면 결제
 * 연결도 결제 시각도 없는 후원이 `paid`가 되어 재고를 팔린 것처럼 차지하고
 * 공개 명단에 빈 날짜로 나타난다. 실제로 결제가 붙었던(= `payment_id`가
 * 있는) 후원만 되돌린다.
 */
export async function revertPledgeCancel(pledgeId: string): Promise<void> {
  await db
    .update(fundingPledges)
    .set({ status: 'paid', canceledAt: null })
    .where(
      and(
        eq(fundingPledges.id, pledgeId),
        eq(fundingPledges.status, 'canceled'),
        isNotNull(fundingPledges.paymentId)
      )
    )
}

/** 토스 환불이 끝난 뒤. 후원 `refunded`와 원장 누적 취소액을 한 트랜잭션으로. */
export async function finalizePledgeRefund(input: {
  orderId: string
  paymentId: string
  pledgeId: string
  canceledAmount: number
  raw: unknown
}): Promise<Row | null> {
  return db.transaction(async tx => {
    const [pledge] = await tx
      .select({ totalAmount: fundingPledges.totalAmount })
      .from(fundingPledges)
      .where(
        and(eq(fundingPledges.id, input.pledgeId), eq(fundingPledges.paymentId, input.paymentId))
      )
      .limit(1)
    if (!pledge) return null
    // 이 프로젝트의 환불은 전액뿐이다 — 후원 총액에 못 미치는 취소액은
    // 아무것도 쓰지 않고 시끄럽게 거부한다(위 클래스 주석 참고).
    if (input.canceledAmount < pledge.totalAmount) {
      throw new PartialRefundUnsupportedError(pledge.totalAmount, input.canceledAmount)
    }

    const [refunded] = await tx
      .update(fundingPledges)
      .set({ status: 'refunded', refundedAt: new Date() })
      .where(
        and(
          eq(fundingPledges.id, input.pledgeId),
          eq(fundingPledges.paymentId, input.paymentId),
          inArray(fundingPledges.status, ['paid', 'canceled'])
        )
      )
      .returning()
    if (!refunded) return null
    // `canceledAmount < input.canceledAmount` 조건은 오늘은 닿지 않는다 —
    // 이 후원 총액보다 작은 취소액은 위에서 이미 시끄럽게 거부되므로, 여기
    // 도달하는 값은 항상 총액 이상이고 원장의 기존 누적 취소액(0 또는 같은
    // 값)보다 작을 수 없다. 부분 환불이 실제로 모델링되면(위 클래스 주석
    // 참고) 이 조건이 재전송된 낡은 통지를 걸러내는 실제 방어선이 된다.
    await tx
      .update(payments)
      .set({
        canceledAmount: input.canceledAmount,
        status: sql`CASE WHEN ${input.canceledAmount} >= ${payments.amount} THEN 'canceled' ELSE 'partial_canceled' END`,
        rawResponse: input.raw,
      })
      .where(
        and(
          eq(payments.orderId, input.orderId),
          sql`${payments.canceledAmount} < ${input.canceledAmount}`
        )
      )
    return rowToPledge(refunded as Row)
  })
}

/** 승인이 확실히 거절됐을 때. 주문 짝이 맞는 pending만 취소한다. */
export async function cancelPendingPledge(
  pledgeId: string,
  expectedOrderId: string
): Promise<Row | null> {
  const [row] = await db
    .update(fundingPledges)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(
      and(
        eq(fundingPledges.id, pledgeId),
        eq(fundingPledges.orderId, expectedOrderId),
        eq(fundingPledges.status, 'pending')
      )
    )
    .returning()
  return row ? rowToPledge(row as Row) : null
}

export async function listExpiredHolds(now: Date = new Date(), limit = 100): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(and(eq(fundingPledges.status, 'pending'), lte(fundingPledges.holdExpiresAt, now)))
    .limit(limit)
  return rows.map(r => rowToPledge(r as Row))
}

export async function expirePledge(pledgeId: string): Promise<boolean> {
  const rows = await db
    .update(fundingPledges)
    .set({ status: 'expired' })
    .where(and(eq(fundingPledges.id, pledgeId), eq(fundingPledges.status, 'pending')))
    .returning({ id: fundingPledges.id })
  return rows.length > 0
}

export async function getPledgeById(id: string): Promise<Row | null> {
  const rows = await db.select().from(fundingPledges).where(eq(fundingPledges.id, id)).limit(1)
  return rows[0] ? rowToPledge(rows[0] as Row) : null
}

export async function getPledgeByOrderId(orderId: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(eq(fundingPledges.orderId, orderId))
    .limit(1)
  return rows[0] ? rowToPledge(rows[0] as Row) : null
}

/** 비회원 본인 확인. 이메일은 대소문자를 가리지 않는다. */
export async function getPledgeByCodeAndEmail(code: string, email: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(
      and(
        eq(fundingPledges.pledgeCode, code),
        sql`lower(${fundingPledges.backerEmail}) = lower(${email})`
      )
    )
    .limit(1)
  return rows[0] ? rowToPledge(rows[0] as Row) : null
}

export async function listPledgesByUser(userId: string): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(eq(fundingPledges.userId, userId))
    .orderBy(desc(fundingPledges.createdAt))
  return rows.map(r => rowToPledge(r as Row))
}

export async function listPledgesByCampaign(
  campaignId: string,
  filter: { status?: string } = {}
): Promise<Row[]> {
  const conditions = [eq(fundingPledges.campaignId, campaignId)]
  if (filter.status)
    conditions.push(
      eq(fundingPledges.status, filter.status as (typeof fundingPledges.$inferSelect)['status'])
    )
  const rows = await db
    .select()
    .from(fundingPledges)
    .where(and(...conditions))
    .orderBy(desc(fundingPledges.createdAt))
  return rows.map(r => rowToPledge(r as Row))
}

/**
 * 한 리워드를 **결제까지 마친** 후원자들. 전달 예정 시기 변경 알림처럼
 * "이 리워드를 고른 사람에게만" 보내야 하는 경로가 쓴다.
 *
 * 알림에 필요한 필드만 고른다 — 배송지·연락처·관리자 메모는 가져오지 않는다.
 * `limit`은 상한이지 페이지가 아니다: 넘치면 호출부가 발송을 포기하고
 * 로그를 남기도록(`MAX_BULK_RECIPIENTS`) 일부러 잘라서 세지 않는다.
 */
export async function listPaidPledgesByReward(
  rewardId: string,
  limit = 1000
): Promise<
  {
    id: string
    pledge_code: string
    user_id: string | null
    backer_email: string
    is_anonymous: boolean
  }[]
> {
  const rows = await db
    .select({
      id: fundingPledges.id,
      pledgeCode: fundingPledges.pledgeCode,
      userId: fundingPledges.userId,
      backerEmail: fundingPledges.backerEmail,
      isAnonymous: fundingPledges.isAnonymous,
    })
    .from(fundingPledges)
    .where(and(eq(fundingPledges.rewardId, rewardId), eq(fundingPledges.status, 'paid')))
    .limit(limit)
  return rows.map(r => ({
    id: r.id,
    pledge_code: r.pledgeCode,
    user_id: r.userId,
    backer_email: r.backerEmail,
    is_anonymous: r.isAnonymous,
  }))
}

/** 공개 명단. 개인정보는 여기서부터 나가지 않는다 — 이름(또는 '익명')과 공개 메시지뿐. */
export async function listPublicBackers(
  campaignId: string,
  limit = 100
): Promise<{ name: string; message: string | null; paid_at: string }[]> {
  const rows = await db
    .select({
      name: fundingPledges.backerName,
      anonymous: fundingPledges.isAnonymous,
      message: fundingPledges.supporterMessage,
      messagePublic: fundingPledges.messagePublic,
      paidAt: fundingPledges.paidAt,
    })
    .from(fundingPledges)
    .where(and(eq(fundingPledges.campaignId, campaignId), eq(fundingPledges.status, 'paid')))
    .orderBy(desc(fundingPledges.paidAt))
    .limit(limit)
  return rows.map(r => ({
    name: r.anonymous ? '익명' : r.name,
    message: r.messagePublic ? (r.message ?? null) : null,
    paid_at: toIso(r.paidAt) ?? '',
  }))
}
