// 상대경로 + 명시적 확장자로 임포트한다 — `scripts/testing/timebankValidate.test.mjs`가
// plain `node --experimental-strip-types --test`로 이 파일을 직접 import한다
// (`src/lib/market/validate.ts`와 같은 이유).
import {
  EXCHANGE_MAX_MINUTES,
  TIMEBANK_CATEGORIES,
  TIMEBANK_DESCRIPTION_MAX,
  TIMEBANK_LISTING_KINDS,
  TIMEBANK_LISTING_STATUSES,
  TIMEBANK_PROFILE_TEXT_MAX,
  TIMEBANK_TITLE_MAX,
  UNIT_MINUTES,
  type TimebankCategory,
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
