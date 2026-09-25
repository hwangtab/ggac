import { FUNDING_CATEGORY } from '@/db/schema/funding'
import { isBlobPublicUrl } from '@/lib/storage/paths'
import { CONTENT_ONLY_FIELDS } from './transitions'

type Verdict<T> = ({ ok: true } & T) | { ok: false; message: string }

const ALL_FIELDS = [
  'title',
  'summary',
  'story',
  'category',
  'goal_amount',
  'start_at',
  'end_at',
  'cover_image',
  'og_image',
  'project_slug',
] as const

function str(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v.trim().slice(0, max) : null
}
function dateOrNull(v: unknown): string | null | false {
  if (v === null || v === '' || v === undefined) return null
  if (typeof v !== 'string' || Number.isNaN(new Date(v).getTime())) return false
  return v
}
/**
 * 연-월(`YYYY-MM`)만 받는다. `estimated_delivery`는 배송 예정월이지 날짜가
 * 아니다 — 형식을 확인하지 않고 앞 7자만 자르면 전체 날짜가 조용히 "연-월"로
 * 둔갑하고, 아무 문자 7개도 날짜처럼 저장된다.
 */
/**
 * `cover_image`·`og_image`는 나중에 페이지가 그대로 렌더한다. 아무 문자열이나
 * 받으면 회원이 편집 가능한 필드로 임의 스킴(`javascript:`)이나 임의
 * 출처(피싱 사이트)를 심을 수 있다. 이 서비스가 실제로 이미지를 담는 곳은
 * 두 곳뿐이다 — 이 사이트가 서빙하는 Blob 공개 저장소(절대 URL, 오리진
 * 대조)와 이 사이트 자신(사이트 상대 경로).
 *
 * "슬래시 하나로 시작하면 상대 경로"라는 접두 매칭은 뚫린다 — `//evil.com`
 * (프로토콜 상대)뿐 아니라 `/\evil.com`(백슬래시)도 브라우저가 호스트를 바꾸는
 * 절대 URL로 읽는다. WHATWG URL 파서는 `http(s)` 같은 "특수 스킴"에서
 * 백슬래시를 슬래시와 동일하게 취급하기 때문이다. 접두어를 늘리는 대신
 * 판정 자체를 바꾼다 — 후보를 아무 의미도 없는 더미 오리진 기준으로
 * 해석해 보고, 해석된 오리진이 여전히 그 더미면 사이트 상대 경로로,
 * 아니면(다른 오리진으로 넘어갔으면) 거부한다. 이 한 규칙이 `//`·`/\`·그
 * 밖의 모든 변형을 한 번에 잡는다.
 * `NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL`이 없는 환경(테스트 등)에서는
 * `isBlobPublicUrl`이 항상 false를 주므로 상대 경로만 허용된다.
 */
const RELATIVE_PATH_PROBE_ORIGIN = 'https://relative-path-probe.invalid'

function isSiteRelativePath(trimmed: string): boolean {
  if (!trimmed.startsWith('/')) return false
  try {
    return new URL(trimmed, RELATIVE_PATH_PROBE_ORIGIN).origin === RELATIVE_PATH_PROBE_ORIGIN
  } catch {
    return false
  }
}

function imageUrlOrNull(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') return false
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 500) return false
  if (isSiteRelativePath(trimmed)) return trimmed
  if (isBlobPublicUrl(trimmed)) return trimmed
  return false
}

function yearMonthOrNull(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string') return false
  const trimmed = v.trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) return false
  return trimmed
}
/**
 * 원 단위 정수만 허용한다. `Number()`에 값을 그대로 넘기면 `[1000000]`(단일
 * 원소 배열)이 `1000000`으로, `'1e6'`이 `1000000`으로 둔갑한다. 숫자 모양을
 * 정규식으로 먼저 확인한 뒤에만 변환한다 —
 * `src/lib/payments/toss/protocol.ts`의 `toWon`과 같은 규칙이다.
 */
function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

export function parseCampaignPatch(
  body: Record<string, unknown>,
  scope: 'all' | 'contentOnly'
): Verdict<{ patch: Record<string, unknown> }> {
  const allowed: readonly string[] = scope === 'all' ? ALL_FIELDS : CONTENT_ONLY_FIELDS
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      if (scope === 'contentOnly' && (ALL_FIELDS as readonly string[]).includes(key)) {
        return {
          ok: false,
          message: '공개된 프로젝트는 소개·본문·이미지·마감일만 바꿀 수 있습니다.',
        }
      }
      continue
    }
    const v = body[key]
    switch (key) {
      case 'title': {
        // 잘라서 저장하면 "수정됐다"는 응답과 실제로 저장된 값이 달라진다 —
        // 길이 초과는 summary와 같이 조용히 자르지 않고 거절한다.
        if (typeof v !== 'string' || v.trim().length === 0)
          return { ok: false, message: '제목을 입력해 주세요.' }
        const trimmed = v.trim()
        if (trimmed.length > 80) return { ok: false, message: '제목은 80자 이내여야 합니다.' }
        patch.title = trimmed
        break
      }
      case 'summary': {
        const s = str(v, 200)
        if (s === null || s.length === 0)
          return { ok: false, message: '한 줄 소개를 200자 이내로 입력해 주세요.' }
        if (typeof v === 'string' && v.trim().length > 200)
          return { ok: false, message: '한 줄 소개는 200자 이내입니다.' }
        patch.summary = s
        break
      }
      case 'story':
        patch.story = typeof v === 'string' ? v.slice(0, 50_000) : ''
        break
      case 'category':
        if (!(FUNDING_CATEGORY as readonly string[]).includes(String(v)))
          return { ok: false, message: '분류가 올바르지 않습니다.' }
        patch.category = v
        break
      case 'goal_amount': {
        const n = toInt(v)
        if (n === null || n <= 0)
          return { ok: false, message: '목표 금액은 1원 이상의 정수입니다.' }
        patch.goal_amount = n
        break
      }
      case 'start_at':
      case 'end_at': {
        const d = dateOrNull(v)
        if (d === false) return { ok: false, message: '날짜 형식이 올바르지 않습니다.' }
        patch[key] = d
        break
      }
      case 'cover_image':
      case 'og_image': {
        const img = imageUrlOrNull(v)
        if (img === false)
          return {
            ok: false,
            message: '이미지 주소는 이 사이트의 저장소 URL이거나 "/"로 시작하는 경로여야 합니다.',
          }
        patch[key] = img
        break
      }
      case 'project_slug':
        patch[key] = str(v, 500)
        break
    }
  }
  return { ok: true, patch }
}

export interface RewardInput {
  id?: string
  title: string
  description?: string | null
  amount: number
  total_quantity: number | null
  requires_shipping: boolean
  requires_credit_name: boolean
  estimated_delivery?: string | null
  image_url?: string | null
  sort_order: number
}

export function parseRewardList(body: unknown): Verdict<{ rewards: RewardInput[] }> {
  if (!Array.isArray(body) || body.length === 0)
    return { ok: false, message: '리워드를 하나 이상 넣어 주세요.' }
  if (body.length > 20) return { ok: false, message: '리워드는 20개까지입니다.' }
  const rewards: RewardInput[] = []
  for (const [i, raw] of body.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>
    const title = str(r.title, 60)
    if (!title) return { ok: false, message: `${i + 1}번째 리워드의 이름을 입력해 주세요.` }
    const amount = Number(r.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0)
      return { ok: false, message: `${title}의 금액이 올바르지 않습니다.` }
    let total_quantity: number | null = null
    if (r.total_quantity !== null && r.total_quantity !== undefined && r.total_quantity !== '') {
      const q = Number(r.total_quantity)
      if (!Number.isSafeInteger(q) || q <= 0)
        return { ok: false, message: `${title}의 수량이 올바르지 않습니다.` }
      total_quantity = q
    }
    // `=== true` 비교라 문자열 `"true"`가 조용히 false로 떨어졌었다 — 배송
    // 여부가 뒤집히면 개설자 명단에서 주소가 통째로 빠지고 아무 오류도 없이
    // 배송 정보가 사라진다. 진짜 boolean만 받고 그 밖은 거절한다.
    let requires_shipping = false
    if (r.requires_shipping !== undefined && r.requires_shipping !== null) {
      if (typeof r.requires_shipping !== 'boolean') {
        return { ok: false, message: `${title}의 배송 필요 여부는 true/false여야 합니다.` }
      }
      requires_shipping = r.requires_shipping
    }
    let requires_credit_name = false
    if (r.requires_credit_name !== undefined && r.requires_credit_name !== null) {
      if (typeof r.requires_credit_name !== 'boolean') {
        return { ok: false, message: `${title}의 이름 기재 여부는 true/false여야 합니다.` }
      }
      requires_credit_name = r.requires_credit_name
    }
    const estimatedDelivery = yearMonthOrNull(r.estimated_delivery)
    if (estimatedDelivery === false) {
      return { ok: false, message: `${title}의 예상 전달월은 YYYY-MM 형식이어야 합니다.` }
    }
    rewards.push({
      id: typeof r.id === 'string' ? r.id : undefined,
      title,
      description: str(r.description, 1000),
      amount,
      total_quantity,
      requires_shipping,
      requires_credit_name,
      estimated_delivery: estimatedDelivery,
      image_url: str(r.image_url, 500),
      sort_order: Number.isInteger(Number(r.sort_order)) ? Number(r.sort_order) : i,
    })
  }
  return { ok: true, rewards }
}

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 60 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  )
}
