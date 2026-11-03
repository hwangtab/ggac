// 관리자·이사회 API(계획 Task 9)의 입력 파서와 판정. DB를 모른다.
// `./settings.ts`가 `@/utils/systemSettings`를 정적 import하므로 `node --test`는
// 별칭 훅을 등록한 뒤 이 파일을 동적 import한다(`timebankAdminRules.test.mjs`).
import { COOP_ACCOUNT, TIMEBANK_MEMO_MAX, type TimebankCategory } from '../../constants/timebank.ts'
import { normalizeTimebankSettings, TIMEBANK_DEFAULTS, type TimebankSettings } from './settings.ts'
import { parseListingInput, type ParseResult } from './validate.ts'

function fail<T>(error: string): ParseResult<T> {
  return { value: null, error }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 회원 id. `validate.ts`의 `MEMBER_ID_RE`와 같은 모양이고, 조합 계좌는 받지 않는다. */
const MEMBER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function memberId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return MEMBER_ID_RE.test(id) && id !== COOP_ACCOUNT ? id : null
}

/** 양의 정수(문자열 숫자도). 30분 배수·범위는 원장이 kind별로 본다. */
function positiveInt(value: unknown): number | null {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = Number(value.trim())
  else return null
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * memo 모양만 본다(글자, 상한). **비었는지는 원장이 본다**(`memo_required`) — 문구와
 * 상태 코드가 `describeLedgerError` 한 곳에서 나오게 한다.
 */
function memoText(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return 'invalid'
  const trimmed = value.trim()
  return trimmed.length > TIMEBANK_MEMO_MAX ? null : trimmed
}

function memoError(m: string | null | 'invalid'): string | null {
  if (m === 'invalid') return '사유(메모)는 글자로 입력해 주세요.'
  if (m === null) return `사유(메모)는 ${TIMEBANK_MEMO_MAX}자를 넘을 수 없습니다.`
  return null
}

// ── 조합 업무 스위치(§7.2) ───────────────────────────────────────────────────

export const COOP_TASKS_OFF_MESSAGE = '조합 업무 크레딧이 지금 꺼져 있습니다.'

/** 조합 업무 글·지급은 전체 스위치와 별도 스위치가 둘 다 `=== true`일 때만 열린다. */
export function coopTasksOpen(settings: TimebankSettings): boolean {
  return settings.enabled === true && settings.coop_tasks_enabled === true
}

// ── 조합 업무 글 ─────────────────────────────────────────────────────────────

export type CoopTaskFields = {
  kind: 'coop_task'
  category: TimebankCategory
  title: string
  description: string
  estimated_minutes: number | null
  task_date: string | null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function validDate(value: string): boolean {
  const m = DATE_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === value
}

/**
 * 조합 업무 글 본문. 글 칸 검사는 조합원 글과 같은 파서(`parseListingInput`)를
 * 그대로 쓴다 — 그 파서는 `coop_task`를 거부하므로 검사용 kind만 바꿔 넣고, 결과의
 * kind는 **항상** `coop_task`다(본문의 kind는 보지 않는다).
 */
export function parseCoopTaskInput(body: unknown): ParseResult<CoopTaskFields> {
  if (!isPlainObject(body)) return fail('요청 형식이 올바르지 않습니다.')
  const base = parseListingInput({ ...body, kind: 'offer' })
  if (base.error !== null) return fail(base.error)

  let taskDate: string | null = null
  if (body.task_date !== undefined && body.task_date !== null && body.task_date !== '') {
    if (typeof body.task_date !== 'string' || !validDate(body.task_date.trim())) {
      return fail('업무 날짜는 YYYY-MM-DD 형식으로 적어 주세요.')
    }
    taskDate = body.task_date.trim()
  }

  const { category, title, description, estimated_minutes } = base.value
  return {
    error: null,
    value: {
      kind: 'coop_task',
      category,
      title,
      description,
      estimated_minutes,
      task_date: taskDate,
    },
  }
}

// ── 조합 업무 지급 ───────────────────────────────────────────────────────────

export type CoopCreditInput = {
  member_id: string
  minutes: number
  memo: string
  /** 정확히 `true`일 때만 true. 원장이 `paid_elsewhere_unconfirmed`로 다시 본다. */
  not_paid_elsewhere: boolean
}

/** 지급 본문 `{ member_id, minutes, memo, not_paid_elsewhere }`. 그 밖의 칸은 버린다. */
export function parseCoopCreditInput(body: unknown): ParseResult<CoopCreditInput> {
  if (!isPlainObject(body)) return fail('요청 형식이 올바르지 않습니다.')
  const member = memberId(body.member_id)
  if (!member) return fail('지급할 조합원을 골라 주세요.')
  const minutes = positiveInt(body.minutes)
  if (minutes === null) return fail('시간 값이 올바르지 않습니다.')
  const memo = memoText(body.memo)
  const memoErr = memoError(memo)
  if (memoErr) return fail(memoErr)
  return {
    error: null,
    value: {
      member_id: member,
      minutes,
      memo: memo as string,
      not_paid_elsewhere: body.not_paid_elsewhere === true,
    },
  }
}

// ── 조정 ─────────────────────────────────────────────────────────────────────

export type AdjustInput = {
  member_id: string
  direction: 'credit' | 'debit'
  minutes: number
  memo: string
  /** 분쟁 정리면 이사회 결정 근거. 비어 있으면 원장이 `resolution_required`로 막는다. */
  dispute: { resolution_ref: string } | null
}

export const RESOLUTION_REF_MIN = 5
export const RESOLUTION_REF_MAX = 200

/**
 * 조정 본문. `direction`은 `credit`(coop → 회원)·`debit`(회원 → coop)만 — 회원 사이로
 * 옮기는 값은 담을 자리가 없다(스펙 §3.1). `dispute: true`면 분쟁 정리(크기 무관 이중 승인).
 */
export function parseAdjustInput(body: unknown): ParseResult<AdjustInput> {
  if (!isPlainObject(body)) return fail('요청 형식이 올바르지 않습니다.')
  const member = memberId(body.member_id)
  if (!member) return fail('조정할 조합원을 골라 주세요.')
  const direction =
    body.direction === 'credit' || body.direction === 'debit' ? body.direction : null
  if (!direction) return fail('적립(credit)·차감(debit) 중 하나를 골라 주세요.')
  const minutes = positiveInt(body.minutes)
  if (minutes === null) return fail('시간 값이 올바르지 않습니다.')
  const memo = memoText(body.memo)
  const memoErr = memoError(memo)
  if (memoErr) return fail(memoErr)

  let dispute: AdjustInput['dispute'] = null
  if (body.dispute === true) {
    const ref = body.resolution_ref
    if (ref !== undefined && ref !== null && typeof ref !== 'string') {
      return fail('이사회 결정 근거는 글자로 입력해 주세요.')
    }
    const trimmed = typeof ref === 'string' ? ref.trim() : ''
    if (trimmed.length > RESOLUTION_REF_MAX) {
      return fail(`이사회 결정 근거는 ${RESOLUTION_REF_MAX}자를 넘을 수 없습니다.`)
    }
    dispute = { resolution_ref: trimmed }
  }
  return {
    error: null,
    value: { member_id: member, direction, minutes, memo: memo as string, dispute },
  }
}

// ── 관리자 취소 ──────────────────────────────────────────────────────────────

/** 관리자 pending 취소 본문 `{ memo }`. 비었는지는 원장이 본다(`memo_required`). */
export function parseAdminCancelInput(body: unknown): ParseResult<{ memo: string }> {
  if (!isPlainObject(body)) return fail('요청 형식이 올바르지 않습니다.')
  const memo = memoText(body.memo)
  const memoErr = memoError(memo)
  if (memoErr) return fail(memoErr)
  return { error: null, value: { memo: memo as string } }
}

// ── 설정 변경(스펙 §9.2) ─────────────────────────────────────────────────────

type SettingsKey = keyof TimebankSettings

const SETTINGS_KEYS = Object.keys(TIMEBANK_DEFAULTS) as SettingsKey[]
/** 이용규칙의 "수치". 이 중 하나라도 바뀌면 `terms_version`도 바뀌어야 한다(§9.4). */
const NUMERIC_KEYS = SETTINGS_KEYS.filter(k => typeof TIMEBANK_DEFAULTS[k] === 'number')

export const TERMS_BUMP_REQUIRED_MESSAGE = '수치를 바꾸면 이용규칙 판도 올려야 합니다.'

export type SettingsChangePlan =
  | {
      ok: true
      next: TimebankSettings
      /** 현재 값과 달라진 칸. */
      changed: SettingsKey[]
      resolution_ref: string
    }
  | { ok: false; status: 400; message: string }

const bad = (message: string): SettingsChangePlan => ({ ok: false, status: 400, message })

/**
 * 설정 PUT 본문 `{ settings: Partial<TimebankSettings>, resolution_ref }`을 판정한다.
 *
 * 1. `resolution_ref`(이사회 일자·안건)는 5~200자 필수.
 * 2. 모르는 칸은 거부한다.
 * 3. `normalizeTimebankSettings({...현재, ...입력})`로 정규화한 뒤 **입력한 칸이
 *    그대로 살아남았는지** 본다. 정규화는 범위 밖 값을 기본값으로 조용히
 *    떨어뜨리는데, 의결된 값이 몰래 다른 값으로 저장되면 안 되므로 거부한다.
 * 4. 바뀐 칸이 없으면 거부한다(의결 근거만 남는 빈 이력을 만들지 않는다).
 * 5. 수치가 바뀌었는데 `terms_version`이 같으면 거부한다(§9.2·§9.4).
 */
export function planTimebankSettingsChange(input: {
  current: unknown
  body: unknown
}): SettingsChangePlan {
  const body = isPlainObject(input.body) ? input.body : {}
  const ref = typeof body.resolution_ref === 'string' ? body.resolution_ref.trim() : ''
  if (ref.length < RESOLUTION_REF_MIN || ref.length > RESOLUTION_REF_MAX) {
    return bad(
      `이사회 의결 근거(일자·안건)를 ${RESOLUTION_REF_MIN}~${RESOLUTION_REF_MAX}자로 적어 주세요.`
    )
  }

  if (!isPlainObject(body.settings)) return bad('바꿀 설정을 보내 주세요.')
  const patch = body.settings
  const keys = Object.keys(patch)
  if (keys.length === 0) return bad('바꿀 설정을 보내 주세요.')
  const unknownKey = keys.find(k => !(SETTINGS_KEYS as string[]).includes(k))
  if (unknownKey) return bad(`알 수 없는 설정 항목입니다: ${unknownKey}`)

  const current = normalizeTimebankSettings(input.current)
  const next = normalizeTimebankSettings({ ...current, ...patch })
  for (const key of keys as SettingsKey[]) {
    const sent = patch[key]
    const expected = typeof sent === 'string' ? sent.trim() : sent
    if (next[key] !== expected) return bad(`${key} 값이 허용 범위를 벗어났습니다.`)
  }

  const changed = SETTINGS_KEYS.filter(k => next[k] !== current[k])
  if (changed.length === 0) return bad('바뀐 값이 없습니다.')
  const numbersChanged = changed.some(k => NUMERIC_KEYS.includes(k))
  if (numbersChanged && next.terms_version === current.terms_version) {
    return bad(TERMS_BUMP_REQUIRED_MESSAGE)
  }

  return { ok: true, next, changed, resolution_ref: ref }
}

// ── 잔액표(스펙 §7.3) ────────────────────────────────────────────────────────

export type AccountFlag = 'over_soft_max' | 'low_balance'

export type AccountsReport = {
  /** 발행잔액(= −coop 잔액). */
  coop_outstanding_minutes: number
  accounts: Array<{
    member_id: string
    display_name: string | null
    balance_minutes: number
    flags: AccountFlag[]
  }>
  flagged_count: number
}

/**
 * `balancesByAccount` 결과 → 관리자 잔액표. 플래그: 잔액 > `soft_max_minutes`이면
 * `over_soft_max`, 잔액 ≤ `low_balance_flag_minutes`이면 `low_balance`.
 * 조합 계좌는 행이 아니라 발행잔액으로 따로 싣는다. 잔액이 낮은 순.
 */
export function buildAccountsReport(input: {
  balances: Array<{ account: string; balance_minutes: number }>
  names: Map<string, { display_name?: string | null }>
  settings: TimebankSettings
}): AccountsReport {
  const { settings } = input
  let coop = 0
  const accounts: AccountsReport['accounts'] = []
  for (const { account, balance_minutes } of input.balances) {
    if (account === COOP_ACCOUNT) {
      coop = balance_minutes
      continue
    }
    const flags: AccountFlag[] = []
    if (balance_minutes > settings.soft_max_minutes) flags.push('over_soft_max')
    if (balance_minutes <= settings.low_balance_flag_minutes) flags.push('low_balance')
    accounts.push({
      member_id: account,
      display_name: input.names.get(account)?.display_name ?? null,
      balance_minutes,
      flags,
    })
  }
  accounts.sort(
    (a, b) => a.balance_minutes - b.balance_minutes || a.member_id.localeCompare(b.member_id)
  )
  return {
    coop_outstanding_minutes: coop === 0 ? 0 : -coop,
    accounts,
    flagged_count: accounts.filter(a => a.flags.length > 0).length,
  }
}
