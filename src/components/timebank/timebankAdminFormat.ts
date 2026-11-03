/**
 * 관리자·이사회 타임뱅크 화면의 공용 타입과 표시 함수. 관리자·이사회 화면은 다른
 * 관리 화면과 같이 한국어 고정이다(조합원 화면은 `timebank` i18n 네임스페이스).
 *
 * 타입은 서버 응답(`TransferRow`·`TimebankSettings`)을 옮겨 적은 것이다 — 클라이언트
 * 화면이 쿼리 계층·서버 설정 모듈을 임포트하지 않게 한다.
 */
import type {
  TimebankCategory,
  TimebankKind,
  TimebankRefType,
  TimebankStatus,
} from '@/constants/timebank'

/** `src/db/queries/timebankLedger.ts`의 `TransferRow`와 같은 모양. */
export type TransferRow = {
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
}

/** `src/lib/timebank/rules.ts`의 `DualApprovalReason`과 같은 값. */
export type DualApprovalReason = 'dispute' | 'admin_target' | 'cumulative_limit'

/** `listPendingAdjustments`의 `PendingAdjustmentRow`와 같은 모양. */
export type PendingAdjustmentRow = TransferRow & { dual_approval_reason: DualApprovalReason }

/** `src/lib/timebank/settings.ts`의 `TimebankSettings`와 같은 모양. */
export type TimebankSettings = {
  enabled: boolean
  coop_tasks_enabled: boolean
  redeem_tickets_enabled: boolean
  redeem_rewards_enabled: boolean
  market_time_enabled: boolean
  terms_version: string
  signup_grant_minutes: number
  min_balance_minutes: number
  soft_max_minutes: number
  low_balance_flag_minutes: number
  coop_task_monthly_cap_minutes: number
  redeem_monthly_cap_minutes: number
  market_item_max_minutes: number
  adjustment_dual_approval_minutes: number
}

export type AccountsResponse = {
  coop_outstanding_minutes: number
  accounts: Array<{
    member_id: string
    display_name: string | null
    balance_minutes: number
    flags: Array<'over_soft_max' | 'low_balance'>
  }>
  flagged_count: number
  thresholds: {
    soft_max_minutes: number
    low_balance_flag_minutes: number
    stale_pending_days: number
  }
  stale_pending: TransferRow[]
  pending_adjustments: PendingAdjustmentRow[]
}

export type SettingsHistoryRow = {
  id: string
  old_value: unknown
  new_value: unknown
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string | null
  change_reason: string | null
}

export const KIND_LABEL: Record<TimebankKind, string> = {
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

export const STATUS_LABEL: Record<TimebankStatus, string> = {
  pending: '대기',
  confirmed: '확정',
  rejected: '거절',
  canceled: '취소',
}

/** 설정 칸 이름표(스펙 §9.1). 1-B 칸은 그렇다고 적는다. */
export const SETTING_LABELS: Record<keyof TimebankSettings, string> = {
  enabled: '타임뱅크 켜기',
  coop_tasks_enabled: '조합 업무 크레딧 켜기',
  redeem_tickets_enabled: '공연 교환권(1-B)',
  redeem_rewards_enabled: '조합 교환소(1-B)',
  market_time_enabled: '장터 시간 거래(1-B)',
  terms_version: '이용규칙 판',
  signup_grant_minutes: '가입 크레딧',
  min_balance_minutes: '잔액 하한(교환·되돌림·조정 차감)',
  soft_max_minutes: '높은 잔액 플래그(초과)',
  low_balance_flag_minutes: '낮은 잔액 플래그(이하)',
  coop_task_monthly_cap_minutes: '조합 업무 월 상한(회원당)',
  redeem_monthly_cap_minutes: '조합 서비스 월 상한(1-B)',
  market_item_max_minutes: '장터 시간 거래 상한(1-B)',
  adjustment_dual_approval_minutes: '조정 이중 승인 기준(그달 누적)',
}

/** 분 → "N시간 M분"(부호 유지). */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const abs = Math.abs(Math.trunc(minutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const sign = minutes < 0 ? '−' : ''
  if (h === 0) return `${sign}${m}분`
  return m === 0 ? `${sign}${h}시간` : `${sign}${h}시간 ${m}분`
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ISO → KST `'YYYY-MM-DD HH:mm'`. */
export function fmtKst(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** 조정 행의 대상 회원(회원 ↔ coop 중 coop이 아닌 쪽)과 방향. */
export function adjustmentTarget(row: TransferRow): {
  memberId: string
  memberName: string | null
  direction: 'credit' | 'debit'
} {
  const credit = row.from_account === 'coop'
  return {
    memberId: credit ? row.to_account : row.from_account,
    memberName: credit ? row.to_name : row.from_name,
    direction: credit ? 'credit' : 'debit',
  }
}

/** 원장 행의 "누가 → 누구" 한 줄. */
export function flowLabel(row: TransferRow): string {
  const name = (account: string, fallback: string | null) =>
    account === 'coop' ? '조합' : fallback || account.slice(0, 8)
  return `${name(row.from_account, row.from_name)} → ${name(row.to_account, row.to_name)}`
}

/** 설정 값 한 칸의 표시. 스위치는 켜짐·꺼짐, 수치는 시간, 판은 그대로. */
export function describeSettingValue(key: keyof TimebankSettings, value: unknown): string {
  if (typeof value === 'boolean') return value ? '켜짐' : '꺼짐'
  if (typeof value === 'number' && key !== 'terms_version') return fmtMinutes(value)
  return String(value ?? '—')
}
