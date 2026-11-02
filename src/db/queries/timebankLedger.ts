/**
 * 타임뱅크 원장 쿼리 계층 (스펙 §3·§5·§6·§7.3·§9.5).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다.** 조합원 여부·관리자
 * 여부·기능 스위치는 호출부(라우트)가 판정한다. 여기서는 원장의 정합성만 지킨다:
 *
 * - 잔액은 저장하지 않는다. `Σ(to = 나) − Σ(from = 나)`, `status = 'confirmed'`만.
 * - **잔액에 영향을 주는 쓰기는 전부 `db.transaction` 하나 안에서 SUM → 판정 →
 *   INSERT/UPDATE를 한다.** libSQL은 트랜잭션을 `BEGIN IMMEDIATE`로 열어 첫
 *   문장부터 쓰기 잠금을 쥐므로 여기서 읽은 잔액과 쓰기 사이에 다른 쓰기가
 *   끼어들 수 없다. 겹친 쓰기는 `SQLITE_BUSY`가 되고 `withWriteRetry`가 처음부터
 *   다시 한다. `db.batch`는 쓰지 않는다(판정을 끼울 수 없다).
 * - 상태 전이는 전부 `UPDATE … WHERE id = ? AND status = 'pending'` 조건부다.
 *   0행이면 원인을 다시 읽어 `TransferStateError`를 던진다.
 * - 판정에 실패하면 던져서 트랜잭션 전체를 되돌린다(확인 실패한 행은 pending으로 남는다).
 *
 * 응답은 snake_case(`toTransferRow`). 임포트는 상대경로 + `.ts` — `node --test`가
 * 이 파일을 직접 import한다(`queriesTimebankLedger.test.mjs`).
 */

import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  memberProfiles,
  timebankListings,
  timebankProfiles,
  timebankTaskVolunteers,
  timebankTransfers,
} from '../schema/index.ts'
import {
  COOP_ACCOUNT,
  MEMBER_TO_MEMBER_KINDS,
  PENDING_LIMIT_PER_PAIR,
  PENDING_LIMIT_PER_RECORDER,
  REJECTION_BLOCK,
  REVERSIBLE_KINDS,
  STALE_PENDING_DAYS,
  STATS_MIN_BUCKET,
  TIMEBANK_KINDS as TIMEBANK_KIND_LIST,
  type TimebankCategory,
  type TimebankKind,
  type TimebankRefType,
  type TimebankStatus,
} from '../../constants/timebank.ts'
import {
  directionFor,
  eligible,
  evaluateTransfer,
  floorFor,
  judgeCoopCredit,
  pairBlocked,
  validMinutes,
  type Party,
  type TransferDraft,
  type TransferRejection,
} from '../../lib/timebank/rules.ts'
import { kstMonthKey, kstMonthRange } from '../../lib/timebank/month.ts'
import type { TimebankSettings } from '../../lib/timebank/settings.ts'

import { toIso } from './_helpers.ts'
import { withWriteRetry } from './_writeRetry.ts'

const t = timebankTransfers
const DAY_MS = 86_400_000

// ── 타입·오류 ────────────────────────────────────────────────────────────────

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface TransferRow {
  id: string
  from_account: string
  to_account: string
  minutes: number
  kind: TimebankKind
  status: TimebankStatus
  created_by: string | null
  counterparty_id: string | null
  decided_by: string | null
  decided_at: string | null
  ref_type: TimebankRefType | null
  ref_id: string | null
  reverses_id: string | null
  category: TimebankCategory | null
  memo: string | null
  from_name: string | null
  to_name: string | null
  approved_by: string | null
  created_at: string | null
  updated_at: string | null
  /**
   * 이 행을 되돌리는 열린(pending·confirmed) 되돌림이 있다. `listTransfersFor`만
   * 채운다 — 그 밖의 경로에서는 없다(undefined). 화면이 "되돌리기 요청"을 다시
   * 내놓지 않게 하는 표시일 뿐, 막는 것은 `createMemberTransfer`의 판정이다.
   */
  reversal_open?: boolean
}

/**
 * 거부 사유. 순수 판정(`TransferRejection`)에 원장 쪽 규칙을 더한 것이다.
 * 라우트가 사람 말로 바꾼다(Task 8 `format.ts`).
 */
export type LedgerRejection =
  | TransferRejection
  /** 기록자의 열린 pending이 상한(10)에 닿았다. */
  | 'pending_limit'
  /** 같은 상대에게 열린 pending이 상한(3)에 닿았다. */
  | 'pair_pending_limit'
  /** 같은 상대에게서 30일 안에 거절 3회 → 30일간 그 상대에게 기록 불가. */
  | 'pair_blocked'
  /** 조합 업무 월 상한(KST, `decided_at`). */
  | 'monthly_cap'
  /** 그 조합 업무 글의 자원 기록이 없다. */
  | 'not_volunteer'
  /** 자원했다가 철회했다. */
  | 'volunteer_withdrawn'
  /** "사례비·인건비를 지급하지 않았다" 확인이 없다. */
  | 'paid_elsewhere_unconfirmed'
  /** 조합 업무 글이 아니거나 지워졌다. */
  | 'not_coop_task'
  /** 같은 글로 그 대상에게 이미 지급했다. */
  | 'already_credited'
  | 'memo_required'
  /** 분쟁 조정에 이사회 결정 근거가 없다. */
  | 'resolution_required'
  /** 조정 승인자가 생성자이거나 대상이다. */
  | 'self_approval'
  /** 그 이동을 되돌리는 pending·confirmed 되돌림이 이미 있다. */
  | 'already_reversed'

export class TransferRejectedError extends Error {
  readonly reason: LedgerRejection
  constructor(reason: LedgerRejection) {
    super(`timebank transfer rejected: ${reason}`)
    this.name = 'TransferRejectedError'
    this.reason = reason
  }
}

export type TransferStateCode = 'not_found' | 'not_pending' | 'not_counterparty' | 'not_recorder'

export class TransferStateError extends Error {
  readonly code: TransferStateCode
  constructor(code: TransferStateCode) {
    super(`timebank transfer state: ${code}`)
    this.name = 'TransferStateError'
    this.code = code
  }
}

const reject = (reason: LedgerRejection) => new TransferRejectedError(reason)

function isLedgerError(e: unknown): boolean {
  return e instanceof TransferRejectedError || e instanceof TransferStateError
}

/** 쓰기 트랜잭션 하나. 판정·상태 오류는 다시 하지 않는다. */
function write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWriteRetry(() => db.transaction(fn), { isFatal: isLedgerError })
}

function reader(tx?: Tx): Tx {
  return tx ?? (db as unknown as Tx)
}

type RawTransfer = typeof timebankTransfers.$inferSelect

export function toTransferRow(r: RawTransfer): TransferRow {
  return {
    id: r.id,
    from_account: r.fromAccount,
    to_account: r.toAccount,
    minutes: r.minutes,
    kind: r.kind,
    status: r.status,
    created_by: r.createdBy ?? null,
    counterparty_id: r.counterpartyId ?? null,
    decided_by: r.decidedBy ?? null,
    decided_at: toIso(r.decidedAt),
    ref_type: r.refType ?? null,
    ref_id: r.refId ?? null,
    reverses_id: r.reversesId ?? null,
    category: r.category ?? null,
    memo: r.memo ?? null,
    from_name: r.fromName ?? null,
    to_name: r.toName ?? null,
    approved_by: r.approvedBy ?? null,
    created_at: toIso(r.createdAt),
    updated_at: toIso(r.updatedAt),
  }
}

const MEMBER_KINDS = [...MEMBER_TO_MEMBER_KINDS] as TimebankKind[]

function includes<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

// ── 잔액 ─────────────────────────────────────────────────────────────────────

/** 확정 행만 합산한 잔액(분). 빈 계좌는 0. `'coop'`도 받는다(음수 = 발행잔액). */
export async function balanceOf(account: string, tx?: Tx): Promise<number> {
  const [row] = await reader(tx)
    .select({
      balance: sql<number>`coalesce(sum(case when ${t.toAccount} = ${account} then ${t.minutes} else 0 end) - sum(case when ${t.fromAccount} = ${account} then ${t.minutes} else 0 end), 0)`,
    })
    .from(t)
    .where(and(eq(t.status, 'confirmed'), or(eq(t.toAccount, account), eq(t.fromAccount, account))))
  return Number(row?.balance ?? 0)
}

/** 모든 계좌의 잔액(`coop` 포함). 받는 쪽 +, 내는 쪽 −를 한 번에 펼쳐 GROUP BY 한 번. 합계는 0이다. */
export async function balancesByAccount(): Promise<
  Array<{ account: string; balance_minutes: number }>
> {
  const rows = await db.all<{ account: string; balance_minutes: number }>(sql`
    SELECT account, SUM(delta) AS balance_minutes FROM (
      SELECT to_account AS account, minutes AS delta FROM timebank_transfers WHERE status = 'confirmed'
      UNION ALL
      SELECT from_account AS account, -minutes AS delta FROM timebank_transfers WHERE status = 'confirmed'
    ) GROUP BY account ORDER BY account`)
  return rows.map(r => ({ account: String(r.account), balance_minutes: Number(r.balance_minutes) }))
}

// ── 당사자 ───────────────────────────────────────────────────────────────────

type Member = { party: Party; name: string | null }

const NOBODY = (id: string): Party => ({
  id,
  approved_active: false,
  withdrawal_requested: false,
  terms_current: false,
})

async function loadMember(q: Tx, memberId: string, termsVersion: string): Promise<Member | null> {
  if (!memberId || memberId === COOP_ACCOUNT) return null
  const [row] = await q
    .select({
      registrationStatus: memberProfiles.registrationStatus,
      isActive: memberProfiles.isActive,
      isSuspended: memberProfiles.isSuspended,
      withdrawalRequestedAt: memberProfiles.withdrawalRequestedAt,
      displayName: memberProfiles.displayName,
      termsVersion: timebankProfiles.termsVersion,
      agreedAt: timebankProfiles.agreedAt,
    })
    .from(memberProfiles)
    .leftJoin(timebankProfiles, eq(timebankProfiles.memberId, memberProfiles.id))
    .where(eq(memberProfiles.id, memberId))
    .limit(1)
  if (!row) return null
  return {
    name: row.displayName ?? null,
    party: {
      id: memberId,
      // 정지는 `is_active = false`를 함께 세팅하지만(`member-action`) 칸도 직접 본다.
      approved_active:
        row.registrationStatus === 'approved' && row.isActive === true && row.isSuspended !== true,
      withdrawal_requested: row.withdrawalRequestedAt != null,
      terms_current: row.agreedAt != null && row.termsVersion === termsVersion,
    },
  }
}

/** 판정 1(스펙 §5)의 재료. 회원이 없으면 null. */
export async function loadParty(
  memberId: string,
  termsVersion: string,
  tx?: Tx
): Promise<Party | null> {
  return (await loadMember(reader(tx), memberId, termsVersion))?.party ?? null
}

// ── 월 합계 ──────────────────────────────────────────────────────────────────

function decidedIn(monthKey: string): SQL {
  const { startMs, endMs } = kstMonthRange(monthKey)
  return and(gte(t.decidedAt, new Date(startMs)), lt(t.decidedAt, new Date(endMs))) as SQL
}

/**
 * 그 KST 월에 확정된(`decided_at`) 이동의 합. `in`은 받은 쪽, `out`은 낸 쪽.
 * `netOfRefunds`면 같은 달 `redeem_refund` 중 같은 달 행을 되돌린 것을 뺀다
 * (조합 서비스 월 사용량, 스펙 §9.5).
 */
export async function monthlySum(
  input: {
    account: string
    kinds: TimebankKind[]
    direction: 'in' | 'out'
    monthKey: string
    netOfRefunds?: boolean
  },
  tx?: Tx
): Promise<number> {
  if (input.kinds.length === 0) return 0
  const q = reader(tx)
  const side = input.direction === 'in' ? t.toAccount : t.fromAccount
  const [row] = await q
    .select({ total: sql<number>`coalesce(sum(${t.minutes}), 0)` })
    .from(t)
    .where(
      and(
        eq(t.status, 'confirmed'),
        inArray(t.kind, input.kinds),
        eq(side, input.account),
        decidedIn(input.monthKey)
      )
    )
  let total = Number(row?.total ?? 0)
  if (input.netOfRefunds) {
    const { startMs, endMs } = kstMonthRange(input.monthKey)
    const refundSide = input.direction === 'in' ? 'from_account' : 'to_account'
    const origSide = input.direction === 'in' ? 'to_account' : 'from_account'
    const kindList = sql.join(
      input.kinds.map(k => sql`${k}`),
      sql`, `
    )
    const [refund] = await q.all<{ total: number }>(sql`
      SELECT coalesce(sum(r.minutes), 0) AS total FROM timebank_transfers r
      WHERE r.kind = 'redeem_refund' AND r.status = 'confirmed'
        AND r.${sql.raw(refundSide)} = ${input.account}
        AND r.decided_at >= ${startMs} AND r.decided_at < ${endMs}
        AND r.reverses_id IN (
          SELECT o.id FROM timebank_transfers o
          WHERE o.status = 'confirmed' AND o.kind IN (${kindList})
            AND o.${sql.raw(origSide)} = ${input.account}
            AND o.decided_at >= ${startMs} AND o.decided_at < ${endMs}
        )`)
    total -= Number(refund?.total ?? 0)
  }
  return total
}

// ── 대기 상한·거절 차단 ──────────────────────────────────────────────────────

/** 기록자의 열린 회원 간 pending 수. `counterpartyId`를 주면 그 쌍만. */
export async function countOpenPending(
  input: { recorderId: string; counterpartyId?: string },
  tx?: Tx
): Promise<number> {
  const [row] = await reader(tx)
    .select({ n: sql<number>`count(*)` })
    .from(t)
    .where(
      and(
        eq(t.status, 'pending'),
        inArray(t.kind, MEMBER_KINDS),
        eq(t.createdBy, input.recorderId),
        input.counterpartyId ? eq(t.counterpartyId, input.counterpartyId) : undefined
      )
    )
  return Number(row?.n ?? 0)
}

/** 기록자가 그 상대에게서 최근 `windowDays`일 안에 받은 거절 수. */
export async function countRecentRejections(
  input: { recorderId: string; counterpartyId: string; windowDays: number },
  tx?: Tx
): Promise<number> {
  const since = new Date(Date.now() - input.windowDays * DAY_MS)
  const [row] = await reader(tx)
    .select({ n: sql<number>`count(*)` })
    .from(t)
    .where(
      and(
        eq(t.status, 'rejected'),
        eq(t.createdBy, input.recorderId),
        eq(t.counterpartyId, input.counterpartyId),
        eq(t.decidedBy, input.counterpartyId),
        gte(t.decidedAt, since)
      )
    )
  return Number(row?.n ?? 0)
}

/**
 * "30일 안에 거절 3회 → 그때부터 30일 차단"(스펙 §5)을 그대로 센다. 창 안의
 * 연속 3회를 찾고, 그 세 번째 거절이 차단 기간 안이면 막는다.
 */
async function pairBlockActive(q: Tx, recorderId: string, counterpartyId: string, now: Date) {
  const { windowDays, blockDays } = REJECTION_BLOCK
  const since = new Date(now.getTime() - (windowDays + blockDays) * DAY_MS)
  const rows = await q
    .select({ at: t.decidedAt })
    .from(t)
    .where(
      and(
        eq(t.status, 'rejected'),
        eq(t.createdBy, recorderId),
        eq(t.counterpartyId, counterpartyId),
        eq(t.decidedBy, counterpartyId),
        gte(t.decidedAt, since)
      )
    )
    .orderBy(asc(t.decidedAt))
  const times = rows.map(r => r.at?.getTime() ?? 0)
  // 차단 기간 안의 각 거절에 대해, 그 거절로 끝나는 창 안의 거절 수를 센다.
  return times.some(
    last =>
      now.getTime() - last < blockDays * DAY_MS &&
      pairBlocked(times.filter(x => x <= last && last - x <= windowDays * DAY_MS).length)
  )
}

// ── 회원 ↔ 회원 기록·확인 ────────────────────────────────────────────────────

async function readTransfer(q: Tx, id: string): Promise<RawTransfer | null> {
  const [row] = await q.select().from(t).where(eq(t.id, id)).limit(1)
  return row ?? null
}

/** 조건부 UPDATE가 0행일 때 원인을 다시 읽는다. */
async function diagnose(
  q: Tx,
  id: string,
  kinds: readonly TimebankKind[],
  mismatch: TransferStateCode
): Promise<TransferStateError> {
  const row = await readTransfer(q, id)
  if (!row || !kinds.includes(row.kind)) return new TransferStateError('not_found')
  if (row.status !== 'pending') return new TransferStateError('not_pending')
  return new TransferStateError(mismatch)
}

function reversesOf(orig: RawTransfer | null): TransferDraft['reverses'] {
  return orig
    ? {
        kind: orig.kind,
        status: orig.status,
        from: orig.fromAccount,
        to: orig.toAccount,
        minutes: orig.minutes,
      }
    : null
}

const OPEN_STATUSES: TimebankStatus[] = ['pending', 'confirmed']

async function hasOpenReversal(q: Tx, reversesId: string): Promise<boolean> {
  const [row] = await q
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.reversesId, reversesId), inArray(t.status, OPEN_STATUSES)))
    .limit(1)
  return Boolean(row)
}

/**
 * 회원 간 기록. 항상 pending이고 상대(`counterparty_id`)가 확인한다.
 *
 * 1-A에서는 `exchange`·`reversal`만 받는다 — `market`은 장터 시간 거래(1-B)라
 * 여기서 `kind_not_allowed`로 막는다(`evaluateTransfer`는 채널 스위치를 보지 않는다).
 *
 * `reversal`의 방향·상대는 원 이동에서 정한다(`role`은 보지 않는다). 본문의
 * `counterpartyId`가 원 이동의 다른 당사자와 다르면 `reverse_mismatch`.
 *
 * 하한은 기록 시점 잔액으로 보는 **미리보기**다. 확정은 확인 시점에 다시 판정한다.
 */
export async function createMemberTransfer(input: {
  recorderId: string
  counterpartyId: string
  kind: 'exchange' | 'market' | 'reversal'
  role: 'received' | 'gave'
  minutes: number
  category?: TimebankCategory | null
  memo?: string | null
  refType?: TimebankRefType | null
  refId?: string | null
  reversesId?: string | null
  listingMinutes?: number | null
  settings: TimebankSettings
}): Promise<TransferRow> {
  if (input.kind !== 'exchange' && input.kind !== 'reversal') throw reject('kind_not_allowed')
  const { settings } = input
  return write(async tx => {
    const now = new Date()

    // 1. 대기 상한·거절 차단(자기 자신 기록은 판정이 `self`로 거른다)
    if (input.recorderId !== input.counterpartyId) {
      if (
        (await countOpenPending({ recorderId: input.recorderId }, tx)) >= PENDING_LIMIT_PER_RECORDER
      ) {
        throw reject('pending_limit')
      }
      const pair = await countOpenPending(
        { recorderId: input.recorderId, counterpartyId: input.counterpartyId },
        tx
      )
      if (pair >= PENDING_LIMIT_PER_PAIR) throw reject('pair_pending_limit')
      if (await pairBlockActive(tx, input.recorderId, input.counterpartyId, now)) {
        throw reject('pair_blocked')
      }
    }

    // 2. 방향. 되돌림은 원 이동의 반대다.
    let from: string
    let to: string
    let counterpartyId = input.counterpartyId
    let reverses: TransferDraft['reverses'] = null
    if (input.kind === 'reversal') {
      const orig = input.reversesId ? await readTransfer(tx, input.reversesId) : null
      if (!orig || !includes(REVERSIBLE_KINDS, orig.kind) || orig.status !== 'confirmed') {
        throw reject('not_reversible')
      }
      reverses = reversesOf(orig)
      from = orig.toAccount
      to = orig.fromAccount
      const other = input.recorderId === from ? to : input.recorderId === to ? from : null
      if (other !== null && other !== input.counterpartyId) throw reject('reverse_mismatch')
      counterpartyId = other ?? input.counterpartyId
    } else {
      ;({ from, to } = directionFor(input.role, input.recorderId, input.counterpartyId))
    }

    // 3. 두 당사자 + 미리보기 잔액으로 판정
    const payer = await loadMember(tx, from, settings.terms_version)
    const payee = await loadMember(tx, to, settings.terms_version)
    const verdict = evaluateTransfer({
      draft: {
        kind: input.kind,
        from,
        to,
        minutes: input.minutes,
        recorder_id: input.recorderId,
        reverses,
        listing_minutes: input.listingMinutes ?? null,
      },
      payer: payer?.party ?? NOBODY(from),
      payee: payee?.party ?? NOBODY(to),
      payerBalanceAfter: (await balanceOf(from, tx)) - input.minutes,
      payeeBalanceAfter: (await balanceOf(to, tx)) + input.minutes,
      settings,
    })
    if (verdict.ok === false) throw reject('reason' in verdict ? verdict.reason : 'bad_minutes')

    // 4. 열린 되돌림은 원 이동당 하나다. 부분 유일 인덱스
    //    (`timebank_transfers_reversal_uq`)가 최종 방어선이지만 그 제약 오류는 원장
    //    오류가 아니라 500이 된다 — 같은 쓰기 트랜잭션 안에서 먼저 보고 사유로 던진다.
    //    당사자 판정 뒤에 둔다(제3자에게 되돌림 존재 여부를 알리지 않는다).
    if (input.kind === 'reversal' && (await hasOpenReversal(tx, input.reversesId as string))) {
      throw reject('already_reversed')
    }

    // 5. pending INSERT
    const [row] = await tx
      .insert(t)
      .values({
        fromAccount: from,
        toAccount: to,
        minutes: input.minutes,
        kind: input.kind,
        status: 'pending',
        createdBy: input.recorderId,
        counterpartyId,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        reversesId: input.kind === 'reversal' ? (input.reversesId ?? null) : null,
        category: input.category ?? null,
        memo: input.memo ?? null,
        fromName: payer?.name ?? null,
        toName: payee?.name ?? null,
        createdAt: now,
      })
      .returning()
    return toTransferRow(row)
  })
}

/**
 * 상대의 확인. 한 트랜잭션에서
 * 1. 조건부 UPDATE로 선점(`pending`·`counterparty_id = actorId`·회원 간 kind만 —
 *    조정 pending은 여기서 닿지 않는다)
 * 2. 두 당사자를 다시 읽고
 * 3. 확정 후 잔액을 SUM해서
 * 4. `evaluateTransfer`로 다시 판정한다. `recorder_id`는 **확인자**다 — 판정 1의
 *    사유(`not_participant`)가 지금 행동하는 사람 기준이 된다.
 * 실패하면 던져서 전체를 되돌린다(행은 pending으로 남는다).
 */
export async function confirmTransfer(input: {
  id: string
  actorId: string
  settings: TimebankSettings
}): Promise<{ row: TransferRow; flags: string[] }> {
  const { settings } = input
  return write(async tx => {
    const now = new Date()
    const [row] = await tx
      .update(t)
      .set({ status: 'confirmed', decidedBy: input.actorId, decidedAt: now })
      .where(
        and(
          eq(t.id, input.id),
          eq(t.status, 'pending'),
          eq(t.counterpartyId, input.actorId),
          inArray(t.kind, MEMBER_KINDS)
        )
      )
      .returning()
    if (!row) throw await diagnose(tx, input.id, MEMBER_KINDS, 'not_counterparty')

    const payer = await loadMember(tx, row.fromAccount, settings.terms_version)
    const payee = await loadMember(tx, row.toAccount, settings.terms_version)
    const orig =
      row.kind === 'reversal' && row.reversesId ? await readTransfer(tx, row.reversesId) : null
    const verdict = evaluateTransfer({
      draft: {
        kind: row.kind,
        from: row.fromAccount,
        to: row.toAccount,
        minutes: row.minutes,
        recorder_id: input.actorId,
        reverses: reversesOf(orig),
        // 1-B 이음매: `market`이면 장터 글의 `credit_minutes`를 여기서 읽어 넘긴다.
        // 1-A에서는 `market` 행이 생기지 않고, 생겨도 null이라 `bad_minutes`로 막힌다.
        listing_minutes: null,
      },
      payer: payer?.party ?? NOBODY(row.fromAccount),
      payee: payee?.party ?? NOBODY(row.toAccount),
      // UPDATE 뒤라 이 SUM은 이미 확정 후 잔액이다.
      payerBalanceAfter: await balanceOf(row.fromAccount, tx),
      payeeBalanceAfter: await balanceOf(row.toAccount, tx),
      settings,
    })
    if (verdict.ok === false) throw reject('reason' in verdict ? verdict.reason : 'bad_minutes')
    // 1-B 이음매: `market`이면 여기서 `onMarketConfirmed(tx, row)`(장터 글 거래완료)를 부른다.
    return { row: toTransferRow(row), flags: verdict.ok ? [...verdict.flags] : [] }
  })
}

async function decideMemberPending(input: {
  id: string
  actorId: string
  status: 'rejected' | 'canceled'
}): Promise<TransferRow> {
  const byCounterparty = input.status === 'rejected'
  return write(async tx => {
    const [row] = await tx
      .update(t)
      .set({ status: input.status, decidedBy: input.actorId, decidedAt: new Date() })
      .where(
        and(
          eq(t.id, input.id),
          eq(t.status, 'pending'),
          byCounterparty ? eq(t.counterpartyId, input.actorId) : eq(t.createdBy, input.actorId),
          inArray(t.kind, MEMBER_KINDS)
        )
      )
      .returning()
    if (!row) {
      throw await diagnose(
        tx,
        input.id,
        MEMBER_KINDS,
        byCounterparty ? 'not_counterparty' : 'not_recorder'
      )
    }
    return toTransferRow(row)
  })
}

/** 상대의 거절. 참여 자격은 보지 않는다 — 정지·구판 동의자도 거절은 할 수 있다(스펙 §9.4). */
export async function rejectTransfer(input: { id: string; actorId: string }): Promise<TransferRow> {
  return decideMemberPending({ ...input, status: 'rejected' })
}

/** 기록자의 취소. */
export async function cancelTransfer(input: { id: string; actorId: string }): Promise<TransferRow> {
  return decideMemberPending({ ...input, status: 'canceled' })
}

// ── 조합 지급 ────────────────────────────────────────────────────────────────

/**
 * 조합 계좌와의 즉시 확정 이동. `signup_grant`·`coop_task`는 coop → 회원,
 * `carryover`는 회원 → coop(재가입 음수 승계).
 *
 * - `monthlyCap`이 있으면 같은 트랜잭션에서 그 kind의 그달(KST, `decided_at`) 합계를 본다.
 * - `signup_grant`·`carryover`는 회원당 1회(부분 유일 인덱스) — `ON CONFLICT DO
 *   NOTHING`이고, 이미 있으면 그 행을 돌려준다.
 * - `tx`를 주면 그 트랜잭션 안에서 돈다(재시도는 호출자 몫). 없으면 자기
 *   트랜잭션을 `withWriteRetry`로 연다.
 *
 * 참여 자격·자원 기록 같은 지급 조건은 보지 않는다 — 조합 업무는 `creditCoopTask`를 쓴다.
 */
export async function issueFromCoop(
  input: {
    kind: 'signup_grant' | 'coop_task' | 'carryover'
    memberId: string
    minutes: number
    actorId: string | null
    memo?: string | null
    refType?: TimebankRefType | null
    refId?: string | null
    monthlyCap?: number
    now?: Date
  },
  tx?: Tx
): Promise<TransferRow> {
  if (!Number.isSafeInteger(input.minutes) || input.minutes <= 0) throw reject('bad_minutes')
  const run = async (q: Tx): Promise<TransferRow> => {
    const now = input.now ?? new Date()
    const outward = input.kind === 'carryover'
    const from = outward ? input.memberId : COOP_ACCOUNT
    const to = outward ? COOP_ACCOUNT : input.memberId

    if (typeof input.monthlyCap === 'number') {
      const used = await monthlySum(
        {
          account: input.memberId,
          kinds: [input.kind],
          direction: outward ? 'out' : 'in',
          monthKey: kstMonthKey(now),
        },
        q
      )
      if (used + input.minutes > input.monthlyCap) throw reject('monthly_cap')
    }

    const member = await loadMember(q, input.memberId, '')
    const values = {
      fromAccount: from,
      toAccount: to,
      minutes: input.minutes,
      kind: input.kind,
      status: 'confirmed' as const,
      createdBy: input.actorId,
      decidedBy: input.actorId,
      decidedAt: now,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      memo: input.memo ?? null,
      fromName: outward ? (member?.name ?? null) : null,
      toName: outward ? null : (member?.name ?? null),
      createdAt: now,
    }

    if (input.kind === 'coop_task') {
      const [row] = await q.insert(t).values(values).returning()
      return toTransferRow(row)
    }
    const [inserted] = await q.insert(t).values(values).onConflictDoNothing().returning()
    if (inserted) return toTransferRow(inserted)
    const [existing] = await q
      .select()
      .from(t)
      .where(and(eq(t.kind, input.kind), eq(outward ? t.fromAccount : t.toAccount, input.memberId)))
      .limit(1)
    return toTransferRow(existing)
  }
  return tx ? run(tx) : write(run)
}

/**
 * 조합 업무 크레딧(스펙 §6.3). 한 트랜잭션에서 지급 조건 재료를 전부 읽고
 * `judgeCoopCredit`(순수 판정)으로 본다: 지급자 본인이 아니고, "사례비·인건비
 * 미지급" 확인이 있고, memo가 있고, 분량이 맞고, 그 글이 살아 있는 `coop_task`이고,
 * 대상이 자원 기록에 있으며 철회하지 않았고, 판정 1을 통과하고, 같은 글로 받은
 * 적이 없다. 월 상한(`decided_at` KST)은 `issueFromCoop`이 같은 트랜잭션에서 SUM한다.
 *
 * 확인 체크는 라우트도 받지만 여기서도 본다 — 라우트가 빠뜨려도 지급되지 않는다.
 * 기능 스위치(`coop_tasks_enabled`)는 라우트가 본다(쿼리 계층은 설정을 읽지 않는다).
 */
export async function creditCoopTask(input: {
  listingId: string
  memberId: string
  actorId: string
  minutes: number
  memo: string
  notPaidElsewhere: boolean
  settings: TimebankSettings
  now?: Date
}): Promise<TransferRow> {
  const { settings } = input
  return write(async tx => {
    const [listing] = await tx
      .select({ id: timebankListings.id })
      .from(timebankListings)
      .where(
        and(
          eq(timebankListings.id, input.listingId),
          eq(timebankListings.kind, 'coop_task'),
          eq(timebankListings.isDeleted, false)
        )
      )
      .limit(1)

    const [volunteer] = await tx
      .select({ withdrawnAt: timebankTaskVolunteers.withdrawnAt })
      .from(timebankTaskVolunteers)
      .where(
        and(
          eq(timebankTaskVolunteers.listingId, input.listingId),
          eq(timebankTaskVolunteers.memberId, input.memberId)
        )
      )
      .limit(1)

    const member = await loadMember(tx, input.memberId, settings.terms_version)

    const [already] = await tx
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          eq(t.kind, 'coop_task'),
          eq(t.status, 'confirmed'),
          eq(t.refId, input.listingId),
          eq(t.toAccount, input.memberId)
        )
      )
      .limit(1)

    const verdict = judgeCoopCredit({
      actorId: input.actorId,
      memberId: input.memberId,
      memo: input.memo,
      notPaidElsewhere: input.notPaidElsewhere,
      minutesValid: validMinutes('coop_task', input.minutes, { settings }),
      listingFound: Boolean(listing),
      volunteer: !volunteer ? 'none' : volunteer.withdrawnAt ? 'withdrawn' : 'active',
      eligible: Boolean(member) && eligible(member.party),
      alreadyCredited: Boolean(already),
    })
    if (verdict) throw reject(verdict)

    return issueFromCoop(
      {
        kind: 'coop_task',
        memberId: input.memberId,
        minutes: input.minutes,
        actorId: input.actorId,
        memo: input.memo.trim(),
        refType: 'listing',
        refId: input.listingId,
        monthlyCap: settings.coop_task_monthly_cap_minutes,
        now: input.now,
      },
      tx
    )
  })
}

// ── 조정 ─────────────────────────────────────────────────────────────────────

/** 그 KST 월의 대상 조정 누적(양방향 절댓값). 확정은 `decided_at`, pending은 `created_at`으로 센다. */
async function adjustmentVolume(q: Tx, memberId: string, monthKey: string): Promise<number> {
  const { startMs, endMs } = kstMonthRange(monthKey)
  const start = new Date(startMs)
  const end = new Date(endMs)
  const [row] = await q
    .select({ total: sql<number>`coalesce(sum(${t.minutes}), 0)` })
    .from(t)
    .where(
      and(
        eq(t.kind, 'adjustment'),
        or(eq(t.fromAccount, memberId), eq(t.toAccount, memberId)),
        or(
          and(eq(t.status, 'confirmed'), gte(t.decidedAt, start), lt(t.decidedAt, end)),
          and(eq(t.status, 'pending'), gte(t.createdAt, start), lt(t.createdAt, end))
        )
      )
    )
  return Number(row?.total ?? 0)
}

/**
 * 관리자 조정(스펙 §7.3). 회원 ↔ coop만(`credit` = coop → 회원, `debit` = 회원 → coop).
 * 대상 ≠ 본인, memo 필수, 30분 배수, 대상은 참여 자격이 있어야 하고, 차감은 하한을 넘지 않는다.
 *
 * 다음 중 하나면 pending(`counterparty_id` null — 조합원 경로로는 닿지 않는다)이고
 * 다른 관리자가 `approveAdjustment`로 확정한다:
 * - 그달(KST) 그 대상의 조정 누적 + 이번 건 > `adjustment_dual_approval_minutes`(쪼개기 방지)
 * - 분쟁 정리(`ref_type = 'dispute'`, `ref_id` = 이사회 결정 근거)
 * - 대상이 관리자(관리자끼리 서로 조정 방지)
 */
export async function createAdjustment(input: {
  adminId: string
  memberId: string
  direction: 'credit' | 'debit'
  minutes: number
  memo: string
  dispute?: { resolution_ref: string } | null
  targetIsAdmin: boolean
  settings: TimebankSettings
  now?: Date
}): Promise<TransferRow> {
  const { settings } = input
  if (input.adminId === input.memberId) throw reject('self')
  if (input.memberId === COOP_ACCOUNT) throw reject('self')
  if (!input.memo?.trim()) throw reject('memo_required')
  if (input.dispute && !input.dispute.resolution_ref?.trim()) throw reject('resolution_required')
  if (!validMinutes('adjustment', input.minutes, { settings })) throw reject('bad_minutes')

  return write(async tx => {
    const now = input.now ?? new Date()
    const member = await loadMember(tx, input.memberId, settings.terms_version)
    if (!member || !eligible(member.party)) throw reject('not_participant')

    const debit = input.direction === 'debit'
    if (debit) {
      const after = (await balanceOf(input.memberId, tx)) - input.minutes
      if (!(after >= floorFor('adjustment', settings))) throw reject('below_floor')
    }

    const cumulative = await adjustmentVolume(tx, input.memberId, kstMonthKey(now))
    const needsApproval =
      cumulative + input.minutes > settings.adjustment_dual_approval_minutes ||
      Boolean(input.dispute) ||
      input.targetIsAdmin === true

    const [row] = await tx
      .insert(t)
      .values({
        fromAccount: debit ? input.memberId : COOP_ACCOUNT,
        toAccount: debit ? COOP_ACCOUNT : input.memberId,
        minutes: input.minutes,
        kind: 'adjustment',
        status: needsApproval ? 'pending' : 'confirmed',
        createdBy: input.adminId,
        counterpartyId: null,
        decidedBy: needsApproval ? null : input.adminId,
        decidedAt: needsApproval ? null : now,
        refType: input.dispute ? 'dispute' : null,
        refId: input.dispute ? input.dispute.resolution_ref.trim() : null,
        memo: input.memo.trim(),
        fromName: debit ? member.name : null,
        toName: debit ? null : member.name,
        createdAt: now,
      })
      .returning()
    return toTransferRow(row)
  })
}

/**
 * 조정 pending의 두 번째 관리자 승인. 조건부 UPDATE(`kind = 'adjustment'`,
 * `pending`)로 선점한 뒤 같은 트랜잭션에서 승인자 ≠ 생성자·대상, 대상의 참여
 * 자격, 차감이면 하한을 다시 본다. 실패하면 전체를 되돌린다.
 */
export async function approveAdjustment(input: {
  id: string
  approverId: string
  settings: TimebankSettings
}): Promise<TransferRow> {
  const { settings } = input
  return write(async tx => {
    const now = new Date()
    const [row] = await tx
      .update(t)
      .set({
        status: 'confirmed',
        approvedBy: input.approverId,
        decidedBy: input.approverId,
        decidedAt: now,
      })
      .where(and(eq(t.id, input.id), eq(t.kind, 'adjustment'), eq(t.status, 'pending')))
      .returning()
    if (!row) throw await diagnose(tx, input.id, ['adjustment'], 'not_pending')

    if (
      row.createdBy === input.approverId ||
      row.fromAccount === input.approverId ||
      row.toAccount === input.approverId
    ) {
      throw reject('self_approval')
    }

    const memberId = row.fromAccount === COOP_ACCOUNT ? row.toAccount : row.fromAccount
    const member = await loadMember(tx, memberId, settings.terms_version)
    if (!member || !eligible(member.party)) throw reject('not_participant')
    if (row.fromAccount === memberId) {
      // UPDATE 뒤라 이미 확정 후 잔액이다.
      if (!((await balanceOf(memberId, tx)) >= floorFor('adjustment', settings))) {
        throw reject('below_floor')
      }
    }
    return toTransferRow(row)
  })
}

// ── 관리자 pending 취소(계획 Task 9, 스펙 §7.3) ─────────────────────────────

/**
 * 분쟁 정리용 관리자 취소. **kind 무관**(회원 간 기록·조정 pending 모두), memo 필수.
 * 상태 전이는 다른 전이와 같이 조건부 UPDATE(`id`·`pending`)로만 하고, 0행이면
 * 원인을 다시 읽는다(`not_found`·`not_pending`). 잔액은 움직이지 않는다(pending은
 * 잔액에 들어가지 않는다) — 그래서 기능 스위치·참여 자격과 무관하게 열린다(§7.2).
 *
 * 사유는 원장 행에 남긴다: 원 memo가 있으면 그 뒤에 `' / 관리자 취소: …'`로 붙이고
 * 없으면 `'관리자 취소: …'`. 원 memo(당사자가 적은 것)를 지우지 않는다.
 */
export async function adminCancelPending(input: {
  id: string
  adminId: string
  memo: string
}): Promise<TransferRow> {
  const reason = typeof input.memo === 'string' ? input.memo.trim() : ''
  if (!reason) throw reject('memo_required')
  return write(async tx => {
    const current = await readTransfer(tx, input.id)
    if (!current) throw new TransferStateError('not_found')
    if (current.status !== 'pending') throw new TransferStateError('not_pending')
    const note = `관리자 취소: ${reason}`
    const [row] = await tx
      .update(t)
      .set({
        status: 'canceled',
        decidedBy: input.adminId,
        decidedAt: new Date(),
        memo: current.memo ? `${current.memo} / ${note}` : note,
      })
      .where(and(eq(t.id, input.id), eq(t.status, 'pending')))
      .returning()
    if (!row) throw await diagnose(tx, input.id, [...TIMEBANK_KIND_LIST], 'not_pending')
    return toTransferRow(row)
  })
}

/** 두 번째 관리자의 승인을 기다리는 조정 전부. 오래된 것부터. */
export async function listPendingAdjustments(): Promise<TransferRow[]> {
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.kind, 'adjustment'), eq(t.status, 'pending')))
    .orderBy(asc(t.createdAt), asc(t.id))
  return rows.map(toTransferRow)
}

// ── 목록 ─────────────────────────────────────────────────────────────────────

const happenedAt = sql`coalesce(${t.decidedAt}, ${t.createdAt})`

/** 회원의 내역(모든 상태). 최근 것부터. `monthKey`는 확정 시각(없으면 기록 시각) 기준. */
export async function listTransfersFor(input: {
  memberId: string
  kinds?: TimebankKind[]
  monthKey?: string
  limit: number
  offset: number
}): Promise<{ rows: TransferRow[]; has_next: boolean }> {
  if (input.kinds && input.kinds.length === 0) return { rows: [], has_next: false }
  const range = input.monthKey ? kstMonthRange(input.monthKey) : null
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        or(eq(t.fromAccount, input.memberId), eq(t.toAccount, input.memberId)),
        input.kinds ? inArray(t.kind, input.kinds) : undefined,
        range
          ? sql`${happenedAt} >= ${range.startMs} AND ${happenedAt} < ${range.endMs}`
          : undefined
      )
    )
    .orderBy(desc(happenedAt), desc(t.createdAt), desc(t.id))
    .limit(input.limit + 1)
    .offset(input.offset)
  const page = rows.slice(0, input.limit)
  const reversible = page
    .filter(r => r.status === 'confirmed' && includes(REVERSIBLE_KINDS, r.kind))
    .map(r => r.id)
  const reversed = new Set<string>()
  if (reversible.length > 0) {
    const open = await db
      .select({ reversesId: t.reversesId })
      .from(t)
      .where(and(inArray(t.reversesId, reversible), inArray(t.status, OPEN_STATUSES)))
    for (const r of open) if (r.reversesId) reversed.add(r.reversesId)
  }
  return {
    rows: page.map(r => ({ ...toTransferRow(r), reversal_open: reversed.has(r.id) })),
    has_next: rows.length > input.limit,
  }
}

/** 회원 간 pending. 내가 확인할 것(`to_confirm`)과 상대를 기다리는 것(`awaiting_other`). */
export async function listPendingFor(
  memberId: string
): Promise<{ to_confirm: TransferRow[]; awaiting_other: TransferRow[] }> {
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.status, 'pending'),
        inArray(t.kind, MEMBER_KINDS),
        or(eq(t.counterpartyId, memberId), eq(t.createdBy, memberId))
      )
    )
    .orderBy(asc(t.createdAt))
  return {
    to_confirm: rows.filter(r => r.counterpartyId === memberId).map(toTransferRow),
    awaiting_other: rows.filter(r => r.createdBy === memberId).map(toTransferRow),
  }
}

/** `days`일을 넘긴 pending 전부(kind 무관 — 조정 pending 포함). 오래된 것부터. */
export async function listStalePending(days: number = STALE_PENDING_DAYS): Promise<TransferRow[]> {
  const before = new Date(Date.now() - days * DAY_MS)
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.status, 'pending'), lt(t.createdAt, before)))
    .orderBy(asc(t.createdAt))
  return rows.map(toTransferRow)
}

// ── 이사회 보고·통계 ─────────────────────────────────────────────────────────

export interface OversightRow {
  month: string
  /** 발행(coop → 회원). */
  issued: {
    signup_grant: number
    coop_task: number
    adjustment_credit: number
    redeem_refund: number
    withdrawal_settlement: number
    total: number
  }
  /** 회수(회원 → coop). 회수한 크레딧은 다시 돌지 않고 소멸한다. */
  retired: {
    redeem: number
    adjustment_debit: number
    carryover: number
    withdrawal_settlement: number
    total: number
  }
  /** 그 달 말 기준 발행잔액(= −coop 잔액). */
  outstanding_minutes: number
  coop_task_by_member: Array<{ member_id: string; name: string | null; minutes: number }>
  /** 그 달 조정 전 건(확정 시각, 없으면 기록 시각 기준). */
  adjustments: Array<{
    id: string
    status: TimebankStatus
    direction: 'credit' | 'debit'
    member_id: string
    member_name: string | null
    minutes: number
    memo: string | null
    created_by: string | null
    approved_by: string | null
    ref_type: TimebankRefType | null
    ref_id: string | null
    created_at: string | null
    decided_at: string | null
  }>
  /** 마이너스 탈퇴 정산(coop이 떠안은 건). */
  negative_withdrawals: Array<{
    member_id: string
    member_name: string | null
    minutes: number
    decided_at: string | null
  }>
}

/** `endMs` 직전까지 확정된 조합 계좌 이동으로 본 발행잔액(= −coop 잔액). */
async function outstandingBefore(endMs: number): Promise<number> {
  const [row] = await db
    .select({
      v: sql<number>`coalesce(sum(case when ${t.fromAccount} = ${COOP_ACCOUNT} then ${t.minutes} else 0 end) - sum(case when ${t.toAccount} = ${COOP_ACCOUNT} then ${t.minutes} else 0 end), 0)`,
    })
    .from(t)
    .where(
      and(
        eq(t.status, 'confirmed'),
        or(eq(t.fromAccount, COOP_ACCOUNT), eq(t.toAccount, COOP_ACCOUNT)),
        lt(t.decidedAt, new Date(endMs))
      )
    )
  return Number(row?.v ?? 0)
}

/**
 * 발행잔액 추이(스펙 §12) — 각 KST 월 말 기준 발행잔액. 이사회 보고 화면이
 * 고른 달과 그 앞 몇 달을 함께 보인다. 받은 순서 그대로 돌려준다.
 */
export async function outstandingTrend(
  monthKeys: string[]
): Promise<Array<{ month: string; outstanding_minutes: number }>> {
  const out: Array<{ month: string; outstanding_minutes: number }> = []
  for (const month of monthKeys) {
    out.push({
      month,
      outstanding_minutes: await outstandingBefore(kstMonthRange(month).endMs),
    })
  }
  return out
}

/** 이사회·감사 월 보고(스펙 §7.4). */
export async function monthlyOversight(monthKey: string): Promise<OversightRow> {
  const { endMs } = kstMonthRange(monthKey)
  const flows = await db
    .select({
      kind: t.kind,
      outward: sql<number>`case when ${t.fromAccount} = ${COOP_ACCOUNT} then 1 else 0 end`,
      total: sql<number>`coalesce(sum(${t.minutes}), 0)`,
    })
    .from(t)
    .where(
      and(
        eq(t.status, 'confirmed'),
        or(eq(t.fromAccount, COOP_ACCOUNT), eq(t.toAccount, COOP_ACCOUNT)),
        decidedIn(monthKey)
      )
    )
    .groupBy(t.kind, sql`case when ${t.fromAccount} = ${COOP_ACCOUNT} then 1 else 0 end`)
  const flow = (kind: TimebankKind, fromCoop: boolean) =>
    Number(flows.find(f => f.kind === kind && Number(f.outward) === (fromCoop ? 1 : 0))?.total ?? 0)

  const issued = {
    signup_grant: flow('signup_grant', true),
    coop_task: flow('coop_task', true),
    adjustment_credit: flow('adjustment', true),
    redeem_refund: flow('redeem_refund', true),
    withdrawal_settlement: flow('withdrawal_settlement', true),
    total: 0,
  }
  issued.total =
    issued.signup_grant +
    issued.coop_task +
    issued.adjustment_credit +
    issued.redeem_refund +
    issued.withdrawal_settlement
  const retired = {
    redeem: flow('redeem', false),
    adjustment_debit: flow('adjustment', false),
    carryover: flow('carryover', false),
    withdrawal_settlement: flow('withdrawal_settlement', false),
    total: 0,
  }
  retired.total =
    retired.redeem + retired.adjustment_debit + retired.carryover + retired.withdrawal_settlement

  const outstanding = await outstandingBefore(endMs)

  const byMember = await db
    .select({
      member_id: t.toAccount,
      name: sql<string | null>`max(${t.toName})`,
      minutes: sql<number>`sum(${t.minutes})`,
    })
    .from(t)
    .where(and(eq(t.kind, 'coop_task'), eq(t.status, 'confirmed'), decidedIn(monthKey)))
    .groupBy(t.toAccount)
    .orderBy(desc(sql`sum(${t.minutes})`), asc(t.toAccount))

  const { startMs } = kstMonthRange(monthKey)
  const adjustments = await db
    .select()
    .from(t)
    .where(
      and(eq(t.kind, 'adjustment'), sql`${happenedAt} >= ${startMs} AND ${happenedAt} < ${endMs}`)
    )
    .orderBy(asc(happenedAt), asc(t.id))

  const settlements = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.kind, 'withdrawal_settlement'),
        eq(t.status, 'confirmed'),
        eq(t.fromAccount, COOP_ACCOUNT),
        decidedIn(monthKey)
      )
    )
    .orderBy(asc(t.decidedAt))

  return {
    month: monthKey,
    issued,
    retired,
    outstanding_minutes: outstanding,
    coop_task_by_member: byMember.map(r => ({
      member_id: r.member_id,
      name: r.name ?? null,
      minutes: Number(r.minutes),
    })),
    adjustments: adjustments.map(r => {
      const credit = r.fromAccount === COOP_ACCOUNT
      return {
        id: r.id,
        status: r.status,
        direction: credit ? ('credit' as const) : ('debit' as const),
        member_id: credit ? r.toAccount : r.fromAccount,
        member_name: (credit ? r.toName : r.fromName) ?? null,
        minutes: r.minutes,
        memo: r.memo ?? null,
        created_by: r.createdBy ?? null,
        approved_by: r.approvedBy ?? null,
        ref_type: r.refType ?? null,
        ref_id: r.refId ?? null,
        created_at: toIso(r.createdAt),
        decided_at: toIso(r.decidedAt),
      }
    }),
    negative_withdrawals: settlements.map(r => ({
      member_id: r.toAccount,
      member_name: r.toName ?? null,
      minutes: r.minutes,
      decided_at: toIso(r.decidedAt),
    })),
  }
}

export interface StatsRow {
  month: string
  /** 그 달 확정 `exchange`. */
  exchange_count: number
  exchange_minutes: number
  /** 그 달 확정 `exchange`의 당사자 수. 3명 미만이면 null. */
  participants: number | null
  /**
   * 양방향 참여자(스펙 §12) — 그 달 말까지 확정 `exchange`에서 한 번 이상 주고
   * 한 번 이상 받은 사람. 3명 미만이면 null.
   */
  bidirectional_participants: number | null
  /** 그 달 회원 간 거절·취소 건수. */
  rejected_count: number
  canceled_count: number
  /** 지금 7일을 넘긴 pending. */
  stale_pending_count: number
  coop_task_minutes: number
  /** `coop_task` / (`coop_task` + `exchange`). 분모가 0이면 null. */
  coop_task_ratio: number | null
  redeem_minutes: number
  /** `redeem` / 전체 확정 회원 지출(회원이 낸 모든 확정 이동). 분모가 0이면 null. */
  redeem_ratio: number | null
  market_count: number
  /** 지금 잔액 분포. 3명 미만이면 null. */
  over_soft_max_members: number | null
  low_balance_members: number | null
}

const bucket = (n: number): number | null => (n < STATS_MIN_BUCKET ? null : n)
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)

/**
 * 조합원 공개 집계·파일럿 지표(스펙 §7.1 `stats`, §12). 사람 수를 세는 구간은
 * 3명 미만이면 null로 숨긴다(식별 방지).
 */
export async function participationStats(
  monthKey: string,
  settings: Pick<TimebankSettings, 'soft_max_minutes' | 'low_balance_flag_minutes'>
): Promise<StatsRow> {
  const { endMs } = kstMonthRange(monthKey)

  const monthRows = await db
    .select({
      kind: t.kind,
      status: t.status,
      fromAccount: t.fromAccount,
      toAccount: t.toAccount,
      minutes: t.minutes,
    })
    .from(t)
    .where(decidedIn(monthKey))

  const confirmed = monthRows.filter(r => r.status === 'confirmed')
  const exchanges = confirmed.filter(r => r.kind === 'exchange')
  const exchangeMinutes = exchanges.reduce((s, r) => s + r.minutes, 0)
  const people = new Set<string>()
  for (const r of exchanges) {
    people.add(r.fromAccount)
    people.add(r.toAccount)
  }
  const coopTaskMinutes = confirmed
    .filter(r => r.kind === 'coop_task')
    .reduce((s, r) => s + r.minutes, 0)
  const redeemMinutes = confirmed
    .filter(r => r.kind === 'redeem')
    .reduce((s, r) => s + r.minutes, 0)
  const memberSpend = confirmed
    .filter(r => r.fromAccount !== COOP_ACCOUNT)
    .reduce((s, r) => s + r.minutes, 0)
  const memberDecided = monthRows.filter(r => includes(MEMBER_TO_MEMBER_KINDS, r.kind))

  const cumulative = await db
    .select({ fromAccount: t.fromAccount, toAccount: t.toAccount })
    .from(t)
    .where(and(eq(t.kind, 'exchange'), eq(t.status, 'confirmed'), lt(t.decidedAt, new Date(endMs))))
  const gave = new Set(cumulative.map(r => r.toAccount))
  const received = new Set(cumulative.map(r => r.fromAccount))
  const bidirectional = [...gave].filter(id => received.has(id)).length

  const [stale] = await db
    .select({ n: sql<number>`count(*)` })
    .from(t)
    .where(
      and(
        eq(t.status, 'pending'),
        lt(t.createdAt, new Date(Date.now() - STALE_PENDING_DAYS * DAY_MS))
      )
    )

  const balances = (await balancesByAccount()).filter(b => b.account !== COOP_ACCOUNT)

  return {
    month: monthKey,
    exchange_count: exchanges.length,
    exchange_minutes: exchangeMinutes,
    participants: bucket(people.size),
    bidirectional_participants: bucket(bidirectional),
    rejected_count: memberDecided.filter(r => r.status === 'rejected').length,
    canceled_count: memberDecided.filter(r => r.status === 'canceled').length,
    stale_pending_count: Number(stale?.n ?? 0),
    coop_task_minutes: coopTaskMinutes,
    coop_task_ratio: ratio(coopTaskMinutes, coopTaskMinutes + exchangeMinutes),
    redeem_minutes: redeemMinutes,
    redeem_ratio: ratio(redeemMinutes, memberSpend),
    market_count: confirmed.filter(r => r.kind === 'market').length,
    over_soft_max_members: bucket(
      balances.filter(b => b.balance_minutes > settings.soft_max_minutes).length
    ),
    low_balance_members: bucket(
      balances.filter(b => b.balance_minutes <= settings.low_balance_flag_minutes).length
    ),
  }
}
