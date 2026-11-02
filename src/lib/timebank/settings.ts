import { getSystemSettings } from '@/utils/systemSettings'

/**
 * `features.timebank_features`(스펙 §9.1). 수치와 스위치는 이사회가 의결한
 * 이용규칙의 내용이라 전용 라우트로만 바뀐다(스펙 §9.2).
 */
export interface TimebankSettings {
  enabled: boolean
  coop_tasks_enabled: boolean
  redeem_tickets_enabled: boolean
  redeem_rewards_enabled: boolean
  market_time_enabled: boolean
  terms_version: string
  signup_grant_minutes: number
  /** `exchange`·`reversal`(원 exchange)·조정 차감의 잔액 하한. −1200~0. */
  min_balance_minutes: number
  soft_max_minutes: number
  /** 이 잔액 이하면 관리자 화면에 플래그. −1200~0. */
  low_balance_flag_minutes: number
  coop_task_monthly_cap_minutes: number
  redeem_monthly_cap_minutes: number
  market_item_max_minutes: number
  adjustment_dual_approval_minutes: number
}

/** 스펙 §9.1 값 그대로. 스위치는 전부 꺼짐. */
export const TIMEBANK_DEFAULTS: TimebankSettings = Object.freeze({
  enabled: false,
  coop_tasks_enabled: false,
  redeem_tickets_enabled: false,
  redeem_rewards_enabled: false,
  market_time_enabled: false,
  terms_version: '2026-11',
  signup_grant_minutes: 120,
  min_balance_minutes: -600,
  soft_max_minutes: 1800,
  low_balance_flag_minutes: -480,
  coop_task_monthly_cap_minutes: 480,
  redeem_monthly_cap_minutes: 480,
  market_item_max_minutes: 240,
  adjustment_dual_approval_minutes: 240,
})

const STEP = 30
const FLOOR_MIN = -1200
const CAP_MAX = 2400
const TERMS_VERSION_MAX = 32

function minutesIn(value: unknown, min: number, max: number, fallback: number): number {
  // 숫자만 받는다 — `Number(null)`·`Number('')`가 0이 되어 유효값으로 새는 걸 막는다.
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fallback
  if (value < min || value > max || value % STEP !== 0) return fallback
  return value
}

/**
 * `normalizeFundingSettings`와 같은 계약: 무엇이 들어와도 던지지 않고, 칸별로
 * 따로 보고 기본값으로 떨어진다. 스위치는 `=== true`일 때만 참이다(fail-closed —
 * `features/settings.ts`의 `readSwitch`는 fail-open이라 쓰지 않는다).
 */
export function normalizeTimebankSettings(raw: unknown): TimebankSettings {
  const r = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >
  const d = TIMEBANK_DEFAULTS
  const terms = typeof r.terms_version === 'string' ? r.terms_version.trim() : ''
  return {
    enabled: r.enabled === true,
    coop_tasks_enabled: r.coop_tasks_enabled === true,
    redeem_tickets_enabled: r.redeem_tickets_enabled === true,
    redeem_rewards_enabled: r.redeem_rewards_enabled === true,
    market_time_enabled: r.market_time_enabled === true,
    terms_version: terms && terms.length <= TERMS_VERSION_MAX ? terms : d.terms_version,
    signup_grant_minutes: minutesIn(r.signup_grant_minutes, 0, CAP_MAX, d.signup_grant_minutes),
    min_balance_minutes: minutesIn(r.min_balance_minutes, FLOOR_MIN, 0, d.min_balance_minutes),
    soft_max_minutes: minutesIn(r.soft_max_minutes, 0, CAP_MAX, d.soft_max_minutes),
    low_balance_flag_minutes: minutesIn(
      r.low_balance_flag_minutes,
      FLOOR_MIN,
      0,
      d.low_balance_flag_minutes
    ),
    coop_task_monthly_cap_minutes: minutesIn(
      r.coop_task_monthly_cap_minutes,
      0,
      CAP_MAX,
      d.coop_task_monthly_cap_minutes
    ),
    redeem_monthly_cap_minutes: minutesIn(
      r.redeem_monthly_cap_minutes,
      0,
      CAP_MAX,
      d.redeem_monthly_cap_minutes
    ),
    market_item_max_minutes: minutesIn(
      r.market_item_max_minutes,
      0,
      CAP_MAX,
      d.market_item_max_minutes
    ),
    adjustment_dual_approval_minutes: minutesIn(
      r.adjustment_dual_approval_minutes,
      0,
      CAP_MAX,
      d.adjustment_dual_approval_minutes
    ),
  }
}

export async function getTimebankSettings(): Promise<TimebankSettings> {
  const settings = await getSystemSettings()
  // 저장된 행은 타입과 달리 아무 모양일 수 있다 — 정규화가 칸별로 기본값에 떨어뜨린다.
  return normalizeTimebankSettings(settings?.features?.timebank_features)
}

export async function isTimebankEnabled(): Promise<boolean> {
  return (await getTimebankSettings()).enabled
}

/** 조합 업무 크레딧은 전체 스위치와 별도 스위치가 둘 다 켜져야 열린다(스펙 §6). */
export async function isCoopTasksEnabled(): Promise<boolean> {
  const s = await getTimebankSettings()
  return s.enabled && s.coop_tasks_enabled
}
