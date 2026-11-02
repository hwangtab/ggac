// 상대경로 + 명시적 확장자로 임포트한다 — `scripts/testing/timebankRules.test.mjs`가
// plain `node --experimental-strip-types --test`로 이 파일을 직접 import한다.
// settings.ts는 별칭 import가 있으므로 타입만 가져온다(런타임에 지워진다).
import {
  EXCHANGE_MAX_MINUTES,
  MEMBER_TO_MEMBER_KINDS,
  REJECTION_BLOCK,
  REVERSIBLE_KINDS,
  SERVICE_FLOOR_MINUTES,
  UNIT_MINUTES,
  type TimebankKind,
  type TimebankStatus,
} from '../../constants/timebank.ts'
import type { TimebankSettings } from './settings.ts'

/**
 * 이동 판정(스펙 §5)의 순수 규칙. 기록 시점과 확인 시점에 모두 부른다.
 * DB를 모르고, 잔액·당사자 상태는 호출자(쿼리 계층)가 같은 트랜잭션에서 읽어 넘긴다.
 */

/** 판정 1의 재료. 쿼리 계층의 `loadParty`가 채운다. */
export type Party = {
  id: string
  /** 승인·활성·정지 아님. */
  approved_active: boolean
  withdrawal_requested: boolean
  /** 현재 판 이용규칙에 동의했다. */
  terms_current: boolean
}

export type TransferDraft = {
  kind: TimebankKind
  from: string
  to: string
  minutes: number
  /**
   * 이번 판정을 요청한 당사자. 기록 시점에는 기록자, 확인 시점에는 확인자를
   * 넘긴다. 판정 1의 사유(`not_participant` / `counterparty_not_participant`)는
   * 이 사람 기준이다.
   */
  recorder_id: string
  /** `reversal`이면 원 이동. */
  reverses?: {
    kind: TimebankKind
    status: TimebankStatus
    from: string
    to: string
    minutes: number
  } | null
  /** `market`이면 글의 `credit_minutes`. */
  listing_minutes?: number | null
}

export type TransferRejection =
  | 'not_participant'
  | 'counterparty_not_participant'
  | 'self'
  | 'recorder_not_party'
  | 'bad_minutes'
  | 'below_floor'
  | 'not_reversible'
  | 'reverse_mismatch'
  | 'kind_not_allowed'

/**
 * `strict: false`라 `ok` 불리언 판별이 `if (v.ok)`로 좁혀지지 않을 수 있다.
 * 실패 쪽은 `v.ok === false`로 검사하고 `reason`은 `'reason' in v`로 꺼낸다.
 */
export type Verdict =
  | { ok: true; flags: 'over_soft_max'[] }
  | { ok: false; reason: TransferRejection }

const NO_FLOOR = Number.NEGATIVE_INFINITY

function includes<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

function isUnitMultiple(minutes: number): boolean {
  return Number.isSafeInteger(minutes) && minutes > 0 && minutes % UNIT_MINUTES === 0
}

function isPositiveInt(minutes: number): boolean {
  return Number.isSafeInteger(minutes) && minutes > 0
}

/**
 * 확정 후 내는 쪽 잔액의 하한. 조합이 내는 kind(발행)와 시스템 정산은 하한이
 * 없다(`-Infinity`). `reversal`은 원 kind의 하한을 쓰고, 원 kind를 모르면 더
 * 엄한 쪽(0)으로 둔다.
 */
export function floorFor(
  kind: TimebankKind,
  settings: TimebankSettings,
  reversesKind?: TimebankKind
): number {
  switch (kind) {
    case 'exchange':
    case 'adjustment':
      return settings.min_balance_minutes
    case 'market':
    case 'redeem':
      return SERVICE_FLOOR_MINUTES
    case 'reversal':
      return reversesKind && reversesKind !== 'reversal'
        ? floorFor(reversesKind, settings)
        : SERVICE_FLOOR_MINUTES
    case 'signup_grant':
    case 'coop_task':
    case 'redeem_refund':
    case 'carryover':
    case 'withdrawal_settlement':
      return NO_FLOOR
    default:
      return SERVICE_FLOOR_MINUTES
  }
}

/** kind별 minutes 범위(스펙 §3.1). */
export function validMinutes(
  kind: TimebankKind,
  minutes: number,
  ctx: { settings: TimebankSettings; listingMinutes?: number | null; reversesMinutes?: number }
): boolean {
  switch (kind) {
    case 'exchange':
    case 'coop_task':
      return isUnitMultiple(minutes) && minutes <= EXCHANGE_MAX_MINUTES
    case 'market':
      return (
        isUnitMultiple(minutes) &&
        typeof ctx.listingMinutes === 'number' &&
        minutes === ctx.listingMinutes
      )
    case 'reversal':
    case 'redeem_refund':
      return (
        isPositiveInt(minutes) &&
        typeof ctx.reversesMinutes === 'number' &&
        minutes === ctx.reversesMinutes
      )
    case 'adjustment':
      return isUnitMultiple(minutes)
    case 'signup_grant':
      return isPositiveInt(minutes) && minutes === ctx.settings.signup_grant_minutes
    case 'carryover':
    case 'redeem':
    case 'withdrawal_settlement':
      return isPositiveInt(minutes)
    default:
      return false
  }
}

/** 판정 1(참여 자격). 쿼리 계층이 회원 ↔ coop 이동(조정·조합 업무)에서도 같은 기준을 쓴다. */
export function eligible(p: Party): boolean {
  return p.approved_active === true && p.withdrawal_requested !== true && p.terms_current === true
}

/**
 * 회원 ↔ 회원 이동(`exchange`·`market`·`reversal`)의 판정. 순서:
 * kind → 자기 자신 → 기록자 당사자 여부 → 판정 1(자격) → 되돌림 모양 →
 * minutes 범위 → 하한 → soft max 플래그.
 */
export function evaluateTransfer(input: {
  draft: TransferDraft
  payer: Party
  payee: Party
  payerBalanceAfter: number
  payeeBalanceAfter: number
  settings: TimebankSettings
}): Verdict {
  const { draft, payer, payee, payerBalanceAfter, payeeBalanceAfter, settings } = input
  const fail = (reason: TransferRejection): Verdict => ({ ok: false, reason })

  if (!includes(MEMBER_TO_MEMBER_KINDS, draft.kind)) return fail('kind_not_allowed')
  if (draft.from === draft.to) return fail('self')
  if (draft.recorder_id !== draft.from && draft.recorder_id !== draft.to) {
    return fail('recorder_not_party')
  }

  const recorderIsPayer = draft.recorder_id === draft.from
  const mine = recorderIsPayer ? payer : payee
  const theirs = recorderIsPayer ? payee : payer
  if (!eligible(mine)) return fail('not_participant')
  if (!eligible(theirs)) return fail('counterparty_not_participant')

  const reverses = draft.reverses ?? null
  if (draft.kind === 'reversal') {
    if (
      !reverses ||
      !includes(REVERSIBLE_KINDS, reverses.kind) ||
      reverses.status !== 'confirmed'
    ) {
      return fail('not_reversible')
    }
    if (
      reverses.from !== draft.to ||
      reverses.to !== draft.from ||
      reverses.minutes !== draft.minutes
    ) {
      return fail('reverse_mismatch')
    }
  }

  if (
    !validMinutes(draft.kind, draft.minutes, {
      settings,
      listingMinutes: draft.listing_minutes ?? null,
      reversesMinutes: reverses?.minutes,
    })
  ) {
    return fail('bad_minutes')
  }

  const floor = floorFor(draft.kind, settings, reverses?.kind)
  if (!(payerBalanceAfter >= floor)) return fail('below_floor')

  const flags: 'over_soft_max'[] = []
  if (payeeBalanceAfter > settings.soft_max_minutes) flags.push('over_soft_max')
  return { ok: true, flags }
}

/**
 * 기록 화면의 "받았다 / 해 줬다"를 원장 방향으로. 도움을 받은 사람이 낸다.
 */
export function directionFor(
  role: 'received' | 'gave',
  me: string,
  counterparty: string
): { from: string; to: string } {
  return role === 'received' ? { from: me, to: counterparty } : { from: counterparty, to: me }
}

/** 같은 상대에게서 창 안에 받은 거절 수 → 그 상대에게 기록이 막혔는가. */
export function pairBlocked(rejectionsFromCounterpartyInWindow: number): boolean {
  return rejectionsFromCounterpartyInWindow >= REJECTION_BLOCK.count
}
