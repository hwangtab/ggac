// 순수 모듈이다 — plain `node --test`가 직접 import한다. 그래서 임포트는 상대경로 +
// `.ts`이고, 원장 쿼리 계층(`timebankLedger.ts`)·설정에서는 **타입만** 가져온다
// (런타임에 지워져 DB·별칭 모듈을 끌어오지 않는다).
import {
  COOP_ACCOUNT,
  EXCHANGE_MAX_MINUTES,
  PENDING_LIMIT_PER_PAIR,
  PENDING_LIMIT_PER_RECORDER,
  REJECTION_BLOCK,
  REVERSIBLE_KINDS,
  STALE_PENDING_DAYS,
  STATS_MIN_BUCKET,
  UNIT_MINUTES,
  type TimebankCategory,
  type TimebankKind,
  type TimebankStatus,
} from '../../constants/timebank.ts'
import type {
  LedgerRejection,
  StatsRow,
  TransferRow,
  TransferStateCode,
} from '../../db/queries/timebankLedger.ts'
import { csvCell } from '../funding/shippingExport.ts'
import type { TimebankSettings } from './settings.ts'

/**
 * 분 → `'N시간 M분'`. 음수는 U+2212(−)를 붙인다. 0은 `'0분'`.
 */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : ''
  const abs = Math.abs(Math.trunc(minutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (h === 0) return `${sign}${m}분`
  return m === 0 ? `${sign}${h}시간` : `${sign}${h}시간 ${m}분`
}

// ── 사유 → 문구 표 (계획 Task 8) ─────────────────────────────────────────────

/**
 * 원장 거부 사유 → 상태 코드·문구. **`LedgerRejection`의 모든 값이 있어야 한다**
 * — `Record`가 컴파일 시점에, `timebankTransferRoute.test.mjs`가 원장 소스의
 * 유니온을 읽어 런타임에 같은 것을 확인한다. 회원 라우트에 닿지 않는 사유
 * (조합 업무·조정)도 같은 표에 둔다 — 관리자 라우트(Task 9)가 쓴다.
 *
 * `{floor}`는 `describeLedgerError`가 설정의 하한으로 채운다.
 */
export const LEDGER_REJECTION_RESPONSES: Record<LedgerRejection, LedgerErrorResponse> = {
  not_participant: {
    status: 403,
    message: '지금은 타임 기록에 참여할 수 없습니다. 이용규칙 동의와 회원 상태를 확인해 주세요.',
  },
  counterparty_not_participant: {
    status: 409,
    message: '상대가 지금 타임뱅크에 참여할 수 없는 상태입니다.',
  },
  self: { status: 400, message: '자기 자신과는 기록할 수 없습니다.' },
  recorder_not_party: { status: 403, message: '거래 당사자만 기록할 수 있습니다.' },
  bad_minutes: {
    status: 400,
    message: `시간은 ${UNIT_MINUTES}분 단위로 ${UNIT_MINUTES}분부터 ${EXCHANGE_MAX_MINUTES / 60}시간까지입니다.`,
  },
  below_floor: { status: 409, message: '확정하면 잔액이 한도({floor})를 넘습니다.' },
  not_reversible: { status: 409, message: '확정된 교환·장터 거래만 되돌릴 수 있습니다.' },
  reverse_mismatch: {
    status: 400,
    message: '되돌리기는 원래 거래의 두 당사자 사이에서 같은 시간으로만 할 수 있습니다.',
  },
  kind_not_allowed: { status: 400, message: '이 종류의 기록은 여기서 만들 수 없습니다.' },
  pending_limit: {
    status: 409,
    message: `확인을 기다리는 기록이 ${PENDING_LIMIT_PER_RECORDER}건이라 더 남길 수 없습니다. 기존 기록이 정리된 뒤 다시 시도해 주세요.`,
  },
  pair_pending_limit: {
    status: 409,
    message: `같은 상대에게 확인을 기다리는 기록이 ${PENDING_LIMIT_PER_PAIR}건입니다. 상대가 확인한 뒤 다시 남겨 주세요.`,
  },
  pair_blocked: {
    status: 403,
    message: `이 상대에게서 거절이 이어져 ${REJECTION_BLOCK.blockDays}일 동안 기록을 남길 수 없습니다.`,
  },
  monthly_cap: { status: 409, message: '이번 달 상한을 넘습니다.' },
  not_volunteer: { status: 409, message: '이 조합원은 이 조합 업무에 자원한 기록이 없습니다.' },
  volunteer_withdrawn: {
    status: 409,
    message: '이 조합원은 이 조합 업무 자원을 철회했습니다. 철회한 사람에게는 지급할 수 없습니다.',
  },
  paid_elsewhere_unconfirmed: {
    status: 400,
    message: '"이 일에 사례비·인건비를 지급하지 않았다"를 확인해야 지급할 수 있습니다.',
  },
  not_coop_task: { status: 404, message: '조합 업무 글을 찾을 수 없습니다.' },
  already_credited: { status: 409, message: '이 조합 업무로 이미 지급했습니다.' },
  memo_required: { status: 400, message: '사유(메모)를 적어 주세요.' },
  resolution_required: {
    status: 400,
    message: '분쟁 정리는 이사회 결정 일자와 안건을 적어야 합니다.',
  },
  self_approval: {
    status: 403,
    message: '조정은 만든 사람도 대상도 아닌 다른 관리자가 승인해야 합니다.',
  },
  already_reversed: {
    status: 409,
    message: '이 거래는 이미 되돌리기 요청이 있거나 되돌려졌습니다.',
  },
}

/** 상태 전이 실패(`TransferStateError.code`) → 상태 코드·문구. */
export const TRANSFER_STATE_RESPONSES: Record<TransferStateCode, LedgerErrorResponse> = {
  not_found: { status: 404, message: '기록을 찾을 수 없습니다.' },
  not_pending: { status: 409, message: '이미 처리된 기록입니다.' },
  not_counterparty: {
    status: 403,
    message: '이 기록은 상대 당사자만 확인하거나 거절할 수 있습니다.',
  },
  not_recorder: { status: 403, message: '이 기록은 남긴 사람만 취소할 수 있습니다.' },
}

export type LedgerErrorResponse = { status: number; message: string }

function own<T extends object>(table: T, key: unknown): key is keyof T {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key)
}

/**
 * 원장 오류(`TransferRejectedError`·`TransferStateError`) → `{ status, code, message }`.
 * 원장 오류가 아니면 null(호출부가 그대로 던져 500으로 처리한다).
 *
 * 클래스를 import하지 않고 `name`으로 가린다 — 이 파일은 DB를 모르는 순수
 * 모듈이다. 실제 클래스로 만든 오류가 통과하는지는 테스트가 고정한다.
 */
export function describeLedgerError(
  error: unknown,
  ctx: { floorMinutes?: number } = {}
): { status: number; code: string; message: string } | null {
  if (!error || typeof error !== 'object') return null
  const e = error as { name?: unknown; reason?: unknown; code?: unknown }
  if (e.name === 'TransferRejectedError' && own(LEDGER_REJECTION_RESPONSES, e.reason)) {
    const { status, message } = LEDGER_REJECTION_RESPONSES[e.reason]
    const floor =
      typeof ctx.floorMinutes === 'number' ? formatMinutes(ctx.floorMinutes) : '설정된 하한'
    return { status, code: e.reason, message: message.replace('{floor}', floor) }
  }
  if (e.name === 'TransferStateError' && own(TRANSFER_STATE_RESPONSES, e.code)) {
    const { status, message } = TRANSFER_STATE_RESPONSES[e.code]
    return { status, code: e.code, message }
  }
  return null
}

// ── 표시 이름 ────────────────────────────────────────────────────────────────

export const TIMEBANK_KIND_LABEL: Record<TimebankKind, string> = {
  exchange: '교환',
  market: '장터',
  reversal: '되돌림',
  signup_grant: '가입 크레딧',
  carryover: '재가입 승계',
  coop_task: '조합 업무',
  redeem: '조합 서비스 사용',
  redeem_refund: '조합 서비스 환불',
  adjustment: '조정',
  withdrawal_settlement: '탈퇴 정산',
}

export const TIMEBANK_STATUS_LABEL: Record<TimebankStatus, string> = {
  pending: '확인 대기',
  confirmed: '확정',
  rejected: '거절',
  canceled: '취소',
}

export const TIMEBANK_CATEGORY_LABEL: Record<TimebankCategory, string> = {
  lesson: '레슨',
  feedback: '피드백',
  production_help: '제작 도움',
  moving: '이동·운반',
  audience: '관객',
  admin_help: '행정 도움',
  daily: '생활',
  etc: '기타',
}

const COOP_NAME = '조합'

// ── KST 표시 ─────────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ISO 시각 → KST `'YYYY-MM-DD HH:mm'`. 비었거나 깨졌으면 빈 문자열. */
export function formatKstDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

// ── 내 내역의 화면용 행 ──────────────────────────────────────────────────────

/**
 * 원장 행 → 본인 시점의 행. 방향(`in` = 나에게 들어옴, `out` = 내가 냄)과 상대를
 * 풀어 주고, 지금 내가 할 수 있는 동작을 붙인다. 관리자 승인자·결정자 id 같은
 * 내부 칸은 싣지 않는다.
 */
export type MyTransferView = {
  id: string
  kind: TimebankKind
  status: TimebankStatus
  direction: 'in' | 'out'
  /** 항상 양수. 방향은 `direction`. */
  minutes: number
  counterparty: { id: string | null; name: string | null }
  category: TimebankCategory | null
  memo: string | null
  ref_type: TransferRow['ref_type']
  ref_id: string | null
  reverses_id: string | null
  recorded_by_me: boolean
  can_confirm: boolean
  can_reject: boolean
  can_cancel: boolean
  /** 확정된 교환·장터 거래이고 열린 되돌림이 없다 → "되돌리기 요청"(§8). */
  can_reverse: boolean
  /** pending이 7일을 넘겼다. */
  stale: boolean
  created_at: string | null
  decided_at: string | null
  /** 정렬·월 필터 기준 시각(확정 시각, 없으면 기록 시각). */
  happened_at: string | null
}

export function toMyTransferView(
  row: TransferRow,
  memberId: string,
  now: number = Date.now()
): MyTransferView {
  const incoming = row.to_account === memberId
  const otherAccount = incoming ? row.from_account : row.to_account
  const otherName = incoming ? row.from_name : row.to_name
  const isCoop = otherAccount === COOP_ACCOUNT
  const pending = row.status === 'pending'
  const createdMs = row.created_at ? Date.parse(row.created_at) : NaN
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    direction: incoming ? 'in' : 'out',
    minutes: Math.abs(row.minutes),
    counterparty: { id: isCoop ? null : otherAccount, name: isCoop ? COOP_NAME : otherName },
    category: row.category,
    memo: row.memo,
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    reverses_id: row.reverses_id,
    recorded_by_me: row.created_by === memberId,
    can_confirm: pending && row.counterparty_id === memberId,
    can_reject: pending && row.counterparty_id === memberId,
    can_cancel: pending && row.created_by === memberId,
    can_reverse:
      row.status === 'confirmed' &&
      (REVERSIBLE_KINDS as readonly string[]).includes(row.kind) &&
      row.reversal_open !== true,
    stale: pending && Number.isFinite(createdMs) && now - createdMs > STALE_PENDING_DAYS * DAY_MS,
    created_at: row.created_at,
    decided_at: row.decided_at,
    happened_at: row.decided_at ?? row.created_at,
  }
}

const DAY_MS = 86_400_000

// ── CSV (스펙 §8 내보내기, §15 M) ─────────────────────────────────────────────

export const TIMEBANK_CSV_HEADERS = [
  '일시(KST)',
  '방향',
  '분',
  '종류',
  '상대',
  '분류',
  '메모',
  '상태',
] as const

/**
 * 내 내역 CSV. 펀딩 배송 목록(`shippingExport.ts`)과 같은 처리 — 맨 앞 BOM(윈도우
 * 엑셀의 한글), `\r\n`, 모든 칸 `csvCell`(수식 주입 차단). **분은 양수로만** 쓰고
 * 방향은 `방향` 칸(받음/줌)이 말한다 — 음수 칸은 `-`로 시작해 수식 차단과
 * 섞이고 엑셀 합계도 헷갈린다.
 */
export function buildTimebankCsv(rows: TransferRow[], memberId: string): string {
  const lines = [TIMEBANK_CSV_HEADERS.map(csvCell).join(',')]
  for (const row of rows) {
    const v = toMyTransferView(row, memberId)
    lines.push(
      [
        csvCell(formatKstDateTime(v.happened_at)),
        csvCell(v.direction === 'in' ? '받음' : '줌'),
        csvCell(v.minutes),
        csvCell(TIMEBANK_KIND_LABEL[v.kind] ?? v.kind),
        csvCell(v.counterparty.name ?? ''),
        csvCell(v.category ? (TIMEBANK_CATEGORY_LABEL[v.category] ?? v.category) : ''),
        csvCell(v.memo ?? ''),
        csvCell(TIMEBANK_STATUS_LABEL[v.status] ?? v.status),
      ].join(',')
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/** `monthKey`는 `parseMonthParam`을 통과한 `'YYYY-MM'`이라 헤더에 그대로 넣어도 안전하다. */
export function timebankCsvDisposition(monthKey: string): string {
  return `attachment; filename="timebank-${monthKey}.csv"`
}

// ── 내 요약 (`GET /api/timebank/me`, 스펙 §8 잔액 영역) ────────────────────────

export function summarizeMe(input: {
  settings: Pick<
    TimebankSettings,
    | 'enabled'
    | 'coop_tasks_enabled'
    | 'terms_version'
    | 'min_balance_minutes'
    | 'coop_task_monthly_cap_minutes'
    | 'redeem_monthly_cap_minutes'
  >
  month: string
  balance: number
  serviceUsed: number
  coopTaskReceived: number
  pending: { to_confirm: number; awaiting_other: number }
  profile: { terms_version: string | null; agreed_at: string | null } | null
}) {
  const { settings, profile } = input
  const agreedVersion = profile?.agreed_at ? (profile.terms_version ?? null) : null
  return {
    enabled: settings.enabled === true,
    coop_tasks_enabled: settings.enabled === true && settings.coop_tasks_enabled === true,
    month: input.month,
    balance_minutes: input.balance,
    floor_minutes: settings.min_balance_minutes,
    room_to_floor_minutes: Math.max(0, input.balance - settings.min_balance_minutes),
    service: { used_minutes: input.serviceUsed, cap_minutes: settings.redeem_monthly_cap_minutes },
    coop_task: {
      received_minutes: input.coopTaskReceived,
      cap_minutes: settings.coop_task_monthly_cap_minutes,
    },
    pending: input.pending,
    terms: {
      current_version: settings.terms_version,
      agreed_version: agreedVersion,
      agreed_at: profile?.agreed_at ?? null,
      needs_agreement: agreedVersion !== settings.terms_version,
    },
  }
}

// ── 공개 집계 (`GET /api/timebank/stats`, 스펙 §7.1·§12) ─────────────────────

const PEOPLE_BUCKETS = [
  'participants',
  'bidirectional_participants',
  'over_soft_max_members',
  'low_balance_members',
] as const

const hide = (n: number | null): number | null =>
  typeof n === 'number' && n >= STATS_MIN_BUCKET ? n : null

/**
 * `participationStats` → 조합원 공개 모양. 정해진 칸만 옮기고, 사람 수 구간을
 * **한 번 더** 가린다(3명 미만 → null, 화면은 "3명 미만"). 쿼리 계층이 이미
 * 가리지만 응답 직전에 다시 못 박는다 — 쿼리에 칸이 늘어 새는 일을 막는다.
 */
export function publicStats(row: StatsRow) {
  const out = {
    month: row.month,
    exchange_count: row.exchange_count,
    exchange_minutes: row.exchange_minutes,
    participants: row.participants,
    bidirectional_participants: row.bidirectional_participants,
    rejected_count: row.rejected_count,
    canceled_count: row.canceled_count,
    stale_pending_count: row.stale_pending_count,
    coop_task_minutes: row.coop_task_minutes,
    coop_task_ratio: row.coop_task_ratio,
    redeem_minutes: row.redeem_minutes,
    redeem_ratio: row.redeem_ratio,
    market_count: row.market_count,
    over_soft_max_members: row.over_soft_max_members,
    low_balance_members: row.low_balance_members,
    min_bucket: STATS_MIN_BUCKET,
  }
  for (const key of PEOPLE_BUCKETS) out[key] = hide(out[key])
  return out
}
