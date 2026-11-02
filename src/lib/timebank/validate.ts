// 상대경로 + 명시적 확장자로 임포트한다 — `scripts/testing/timebankValidate.test.mjs`가
// plain `node --experimental-strip-types --test`로 이 파일을 직접 import한다
// (`src/lib/market/validate.ts`와 같은 이유).
import {
  COOP_ACCOUNT,
  EXCHANGE_MAX_MINUTES,
  TIMEBANK_CATEGORIES,
  TIMEBANK_CHANNELS,
  TIMEBANK_DESCRIPTION_MAX,
  TIMEBANK_LISTING_KINDS,
  TIMEBANK_LISTING_STATUSES,
  TIMEBANK_MEMO_MAX,
  TIMEBANK_PROFILE_TEXT_MAX,
  TIMEBANK_TITLE_MAX,
  UNIT_MINUTES,
  type TimebankCategory,
  type TimebankChannel,
  type TimebankKind,
  type TimebankListingKind,
  type TimebankListingStatus,
} from '../../constants/timebank.ts'

/**
 * 타임뱅크 게시판·프로필 입력 파서(스펙 §3·§4·§7.1). 메시지는 화면에 그대로 뜬다.
 *
 * 판별 키를 `ok: boolean`으로 두지 않는 이유는 장터 파서와 같다 — `strict: false`라
 * 불리언 판별 유니온이 좁혀지지 않는다. 실패면 `value === null`, 성공이면 `error === null`.
 */
export type ParseResult<T> = { value: T; error: null } | { value: null; error: string }

/** 조합원이 쓸 수 있는 글 종류. `coop_task`는 관리자 라우트(Task 9)만 만든다. */
export const MEMBER_LISTING_KINDS = ['offer', 'request'] as const
export type MemberListingKind = (typeof MEMBER_LISTING_KINDS)[number]

/** 조합원 글쓰기 본문 → 저장할 값. 본문의 다른 칸(작성자·상태 등)은 버린다. */
export type ListingFields = {
  kind: MemberListingKind
  category: TimebankCategory
  title: string
  description: string
  estimated_minutes: number | null
}

export type ProfileFields = {
  offers?: string
  needs?: string
  categories?: TimebankCategory[]
  visible?: boolean
}

export type ListingQuery = {
  kind?: TimebankListingKind
  category?: TimebankCategory
  status?: TimebankListingStatus
  page: number
  mine: boolean
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function fail<T>(error: string): ParseResult<T> {
  return { value: null, error }
}

/** 30분 배수(30~480) 또는 미정(null). 문자열 숫자도 받는다(입력칸 값). */
function parseEstimatedMinutes(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = Number(value.trim())
  else return 'invalid'
  if (!Number.isSafeInteger(n) || n < UNIT_MINUTES || n > EXCHANGE_MAX_MINUTES) return 'invalid'
  if (n % UNIT_MINUTES !== 0) return 'invalid'
  return n
}

export function parseListingStatus(value: unknown): TimebankListingStatus | null {
  return oneOf(TIMEBANK_LISTING_STATUSES, value)
}

/** 생성·전체 수정 공통. */
export function parseListingInput(body: Record<string, unknown>): ParseResult<ListingFields> {
  if (body?.kind === 'coop_task') return fail('조합 업무는 관리자 화면에서 올립니다.')
  const kind = oneOf(MEMBER_LISTING_KINDS, body?.kind)
  if (!kind) return fail('제공·요청 중 하나를 골라 주세요.')

  const category = oneOf(TIMEBANK_CATEGORIES, body.category)
  if (!category) return fail('분류를 골라 주세요.')

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return fail('제목을 입력해 주세요.')
  if (title.length > TIMEBANK_TITLE_MAX) {
    return fail(`제목은 ${TIMEBANK_TITLE_MAX}자를 넘을 수 없습니다.`)
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return fail('설명을 입력해 주세요.')
  if (description.length > TIMEBANK_DESCRIPTION_MAX) {
    return fail(`설명은 ${TIMEBANK_DESCRIPTION_MAX}자를 넘을 수 없습니다.`)
  }

  const estimated = parseEstimatedMinutes(body.estimated_minutes)
  if (estimated === 'invalid') {
    return fail(
      `예상 시간은 ${UNIT_MINUTES}분 단위로 ${EXCHANGE_MAX_MINUTES / 60}시간까지 적거나 비워 주세요.`
    )
  }

  return {
    error: null,
    value: { kind, category, title, description, estimated_minutes: estimated },
  }
}

/** 목록 쿼리스트링. 모르는 값은 버린다(필터 없음). `kind`는 조합 업무 탭도 받는다(읽기). */
export function parseListingQuery(params: URLSearchParams): ListingQuery {
  const pageRaw = Number(params.get('page'))
  return {
    kind: oneOf(TIMEBANK_LISTING_KINDS, params.get('kind')) ?? undefined,
    category: oneOf(TIMEBANK_CATEGORIES, params.get('category')) ?? undefined,
    status: parseListingStatus(params.get('status')) ?? undefined,
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? pageRaw : 1,
    mine: params.get('mine') === '1',
  }
}

/** 프로필 부분 수정. 준 칸만 담고, 아는 칸이 하나도 없으면 에러. */
export function parseProfileInput(body: Record<string, unknown>): ParseResult<ProfileFields> {
  const out: ProfileFields = {}
  for (const field of ['offers', 'needs'] as const) {
    if (body?.[field] === undefined) continue
    const v = body[field]
    if (typeof v !== 'string') return fail('글자로 입력해 주세요.')
    const trimmed = v.trim()
    if (trimmed.length > TIMEBANK_PROFILE_TEXT_MAX) {
      return fail(`${TIMEBANK_PROFILE_TEXT_MAX}자를 넘을 수 없습니다.`)
    }
    out[field] = trimmed
  }
  if (body?.categories !== undefined) {
    if (!Array.isArray(body.categories)) return fail('분류 값이 올바르지 않습니다.')
    const cats: TimebankCategory[] = []
    for (const c of body.categories) {
      const cat = oneOf(TIMEBANK_CATEGORIES, c)
      if (!cat) return fail('분류 값이 올바르지 않습니다.')
      if (!cats.includes(cat)) cats.push(cat)
    }
    out.categories = cats
  }
  if (body?.visible !== undefined) {
    if (typeof body.visible !== 'boolean') return fail('공개 여부 값이 올바르지 않습니다.')
    out.visible = body.visible
  }
  if (Object.keys(out).length === 0) return fail('바꿀 내용이 없습니다.')
  return { error: null, value: out }
}

// ── 기록·결정·내역 (계획 Task 8, 스펙 §5·§7.1·§8) ─────────────────────────────

/**
 * 기록 본문 → 원장에 넘길 값. **`kind`·`from_account`·`to_account`·`coop`은
 * 담을 자리가 없다** — kind는 `reverses_id` 유무로만 정하고(`reversal` 아니면
 * `exchange`), 방향은 원장이 `directionFor(role, 요청자, 상대)`로 만든다.
 * `market`은 1-B(장터 시간 거래)라 이 파서로는 만들 수 없다.
 */
export type TransferInput = {
  kind: 'exchange' | 'reversal'
  counterparty_id: string
  /** `reversal`이면 null — 방향은 원 이동에서 정한다. */
  role: 'received' | 'gave' | null
  minutes: number
  category: TimebankCategory | null
  memo: string | null
  /** 관련 게시판 글. `reversal`이면 null. */
  listing_id: string | null
  reverses_id: string | null
}

export const TRANSFER_ROLES = ['received', 'gave'] as const
export const TRANSFER_ACTIONS = ['confirm', 'reject', 'cancel'] as const
export type TransferAction = (typeof TRANSFER_ACTIONS)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 회원 id. Better Auth는 UUID를 쓰지만 이관 계정·테스트 계정도 받도록 형식만 좁힌다. */
const MEMBER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function optionalUuid(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) return 'invalid'
  return value.trim().toLowerCase()
}

function positiveInt(value: unknown): number | null {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = Number(value.trim())
  else return null
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function parseTransferInput(body: unknown): ParseResult<TransferInput> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail('요청 형식이 올바르지 않습니다.')
  }
  const b = body as Record<string, unknown>

  const counterparty = typeof b.counterparty_id === 'string' ? b.counterparty_id.trim() : ''
  if (!MEMBER_ID_RE.test(counterparty) || counterparty === COOP_ACCOUNT) {
    return fail('기록할 상대를 골라 주세요.')
  }

  const reversesId = optionalUuid(b.reverses_id)
  if (reversesId === 'invalid') return fail('되돌릴 거래 값이 올바르지 않습니다.')
  const kind: TransferInput['kind'] = reversesId ? 'reversal' : 'exchange'

  let role: TransferInput['role'] = null
  if (kind === 'exchange') {
    role = oneOf(TRANSFER_ROLES, b.role)
    if (!role) return fail('도움을 받았는지 주었는지 골라 주세요.')
  }

  const minutes = positiveInt(b.minutes)
  if (kind === 'exchange') {
    if (
      minutes === null ||
      minutes < UNIT_MINUTES ||
      minutes > EXCHANGE_MAX_MINUTES ||
      minutes % UNIT_MINUTES !== 0
    ) {
      return fail(
        `시간은 ${UNIT_MINUTES}분 단위로 ${EXCHANGE_MAX_MINUTES / 60}시간까지 적어 주세요.`
      )
    }
  } else if (minutes === null) {
    return fail('시간 값이 올바르지 않습니다.')
  }

  let category: TimebankCategory | null = null
  if (b.category !== undefined && b.category !== null && b.category !== '') {
    category = oneOf(TIMEBANK_CATEGORIES, b.category)
    if (!category) return fail('분류 값이 올바르지 않습니다.')
  }

  let memo: string | null = null
  if (b.memo !== undefined && b.memo !== null) {
    if (typeof b.memo !== 'string') return fail('메모는 글자로 입력해 주세요.')
    const trimmed = b.memo.trim()
    if (trimmed.length > TIMEBANK_MEMO_MAX) {
      return fail(`메모는 ${TIMEBANK_MEMO_MAX}자를 넘을 수 없습니다.`)
    }
    memo = trimmed || null
  }

  const listingId = optionalUuid(b.listing_id)
  if (listingId === 'invalid') return fail('관련 글 값이 올바르지 않습니다.')

  return {
    error: null,
    value: {
      kind,
      counterparty_id: counterparty,
      role,
      minutes,
      category,
      memo,
      listing_id: kind === 'reversal' ? null : listingId,
      reverses_id: reversesId,
    },
  }
}

/** `[action]` 세그먼트. 모르는 값은 null → 404. */
export function parseTransferAction(value: unknown): TransferAction | null {
  return oneOf(TRANSFER_ACTIONS, value)
}

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/

/** `'YYYY-MM'`만. 그 밖은 null. */
export function parseMonthParam(value: unknown): string | null {
  return typeof value === 'string' && MONTH_PARAM.test(value) ? value : null
}

export type MyTransfersQuery = {
  channel: TimebankChannel | null
  kinds: TimebankKind[] | null
  month: string | null
  page: number
}

/**
 * 내 내역 쿼리스트링. **`channel`·`month`·`page`만 읽는다** — `member_id` 같은
 * 칸은 보지도 않는다. 누구의 내역인지는 라우트가 세션에서 넣는다(스펙 §8).
 */
export function parseMyTransfersQuery(params: URLSearchParams): MyTransfersQuery {
  const rawChannel = params.get('channel')
  const channel =
    rawChannel && Object.prototype.hasOwnProperty.call(TIMEBANK_CHANNELS, rawChannel)
      ? (rawChannel as TimebankChannel)
      : null
  const pageRaw = Number(params.get('page'))
  return {
    channel,
    kinds: channel ? [...TIMEBANK_CHANNELS[channel]] : null,
    month: parseMonthParam(params.get('month')),
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? pageRaw : 1,
  }
}
