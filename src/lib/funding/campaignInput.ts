import { FUNDING_CATEGORY } from '@/db/schema/funding'
import { CONTENT_ONLY_FIELDS } from './transitions'

type Verdict<T> = ({ ok: true } & T) | { ok: false; message: string }

const ALL_FIELDS = ['title', 'summary', 'story', 'category', 'goal_amount', 'start_at', 'end_at', 'cover_image', 'og_image', 'project_slug'] as const

function str(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v.trim().slice(0, max) : null
}
function dateOrNull(v: unknown): string | null | false {
  if (v === null || v === '' || v === undefined) return null
  if (typeof v !== 'string' || Number.isNaN(new Date(v).getTime())) return false
  return v
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
        return { ok: false, message: '공개된 프로젝트는 소개·본문·이미지·마감일만 바꿀 수 있습니다.' }
      }
      continue
    }
    const v = body[key]
    switch (key) {
      case 'title': {
        const s = str(v, 80)
        if (!s) return { ok: false, message: '제목을 입력해 주세요.' }
        patch.title = s; break
      }
      case 'summary': {
        const s = str(v, 200)
        if (s === null || s.length === 0) return { ok: false, message: '한 줄 소개를 200자 이내로 입력해 주세요.' }
        if (typeof v === 'string' && v.trim().length > 200) return { ok: false, message: '한 줄 소개는 200자 이내입니다.' }
        patch.summary = s; break
      }
      case 'story': patch.story = typeof v === 'string' ? v.slice(0, 50_000) : ''; break
      case 'category':
        if (!(FUNDING_CATEGORY as readonly string[]).includes(String(v))) return { ok: false, message: '분류가 올바르지 않습니다.' }
        patch.category = v; break
      case 'goal_amount': {
        const n = Number(v)
        if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, message: '목표 금액은 1원 이상의 정수입니다.' }
        patch.goal_amount = n; break
      }
      case 'start_at':
      case 'end_at': {
        const d = dateOrNull(v)
        if (d === false) return { ok: false, message: '날짜 형식이 올바르지 않습니다.' }
        patch[key] = d; break
      }
      case 'cover_image':
      case 'og_image':
      case 'project_slug':
        patch[key] = str(v, 500); break
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
  estimated_delivery?: string | null
  image_url?: string | null
  sort_order: number
}

export function parseRewardList(body: unknown): Verdict<{ rewards: RewardInput[] }> {
  if (!Array.isArray(body) || body.length === 0) return { ok: false, message: '리워드를 하나 이상 넣어 주세요.' }
  if (body.length > 20) return { ok: false, message: '리워드는 20개까지입니다.' }
  const rewards: RewardInput[] = []
  for (const [i, raw] of body.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>
    const title = str(r.title, 60)
    if (!title) return { ok: false, message: `${i + 1}번째 리워드의 이름을 입력해 주세요.` }
    const amount = Number(r.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: `${title}의 금액이 올바르지 않습니다.` }
    let total_quantity: number | null = null
    if (r.total_quantity !== null && r.total_quantity !== undefined && r.total_quantity !== '') {
      const q = Number(r.total_quantity)
      if (!Number.isSafeInteger(q) || q <= 0) return { ok: false, message: `${title}의 수량이 올바르지 않습니다.` }
      total_quantity = q
    }
    rewards.push({
      id: typeof r.id === 'string' ? r.id : undefined,
      title,
      description: str(r.description, 1000),
      amount,
      total_quantity,
      requires_shipping: r.requires_shipping === true,
      estimated_delivery: str(r.estimated_delivery, 7),
      image_url: str(r.image_url, 500),
      sort_order: Number.isInteger(Number(r.sort_order)) ? Number(r.sort_order) : i,
    })
  }
  return { ok: true, rewards }
}

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}
