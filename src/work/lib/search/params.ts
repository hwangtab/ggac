import { z } from 'zod'

const uuid = z.string().uuid()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export type SearchParams = {
  q: string
  channel: string | null
  author: string | null
  /** YYYY-MM-DD (KST, 포함) */
  from: string | null
  /** YYYY-MM-DD (KST, 포함) */
  to: string | null
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? ''
}

/** URL 쿼리스트링 → 검증된 검색 조건. 잘못된 필터 값은 조용히 버린다(검색어만 있으면 동작). */
export function parseSearchParams(
  raw: Record<string, string | string[] | undefined>
): SearchParams {
  const opt = <T extends z.ZodTypeAny>(schema: T, v: string): string | null => {
    const r = schema.safeParse(v)
    return r.success ? (r.data as string) : null
  }
  return {
    q: first(raw.q).slice(0, 200),
    channel: opt(uuid, first(raw.channel)),
    author: opt(uuid, first(raw.author)),
    from: opt(day, first(raw.from)),
    to: opt(day, first(raw.to)),
  }
}

const KST = '+09:00'

/** from(포함) ~ to(포함)를 KST 기준 [시작, 다음날 시작) 반개구간 ISO 로 바꾼다. */
export function dateRangeToIso(
  from: string | null,
  to: string | null
): { fromIso: string | null; toIso: string | null } {
  const fromIso = from ? new Date(`${from}T00:00:00${KST}`).toISOString() : null
  let toIso: string | null = null
  if (to) {
    const end = new Date(`${to}T00:00:00${KST}`)
    end.setUTCDate(end.getUTCDate() + 1)
    toIso = end.toISOString()
  }
  return { fromIso, toIso }
}

/** 현재 조건을 /search 쿼리스트링으로(빈 값 제외). */
export function buildSearchHref(p: Partial<SearchParams>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v)
  const qs = sp.toString()
  return qs ? `/search?${qs}` : '/search'
}
