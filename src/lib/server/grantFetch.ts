/**
 * kosmart 공고 API 호출. **네트워크 경계만** 담당한다 — 판정은
 * `src/lib/server/grantDigest.ts`가 하고 여기는 가져오기만 한다.
 */
import type { GrantItem } from '@/db/queries/grantDigests'
import { DIGEST_GENRES, DIGEST_REGIONS, WINDOW_DAYS, CAP } from '@/lib/server/grantDigest'

/** 응답에 필요한 필드가 다 있는지 본다. 없는 항목은 조용히 버리지 않고 호출부가 세게 한다. */
function isGrantItem(v: unknown): v is GrantItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.key === 'string' &&
    typeof o.source === 'string' &&
    typeof o.source_id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.url === 'string' &&
    Array.isArray(o.genres) &&
    Array.isArray(o.regions) &&
    (o.apply_end === null || typeof o.apply_end === 'string')
  )
}

/**
 * @throws 환경변수 누락·HTTP 실패·응답 형식 오류는 전부 던진다. 호출부(크론 라우트)가
 *   관리자에게 알린다 — 조용히 빈 배열을 돌려주면 "이번 주는 공고가 없었다"와 구분되지 않는다.
 */
export async function fetchGrantOpportunities(): Promise<GrantItem[]> {
  const base = process.env.KOSMART_OPPORTUNITIES_URL
  const token = process.env.KOSMART_API_TOKEN
  if (!base) throw new Error('KOSMART_OPPORTUNITIES_URL이 설정되지 않았습니다.')
  if (!token) throw new Error('KOSMART_API_TOKEN이 설정되지 않았습니다.')

  const url = new URL(base)
  url.searchParams.set('genres', DIGEST_GENRES.join(','))
  url.searchParams.set('regions', DIGEST_REGIONS.join(','))
  url.searchParams.set('days', String(WINDOW_DAYS))
  // CAP보다 넉넉히 받아온다 — 중복 제거로 빠진 만큼을 뒤에서 채울 수 있게.
  url.searchParams.set('limit', String(CAP * 4))
  url.searchParams.set('strictRegion', 'true')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`kosmart 공고 조회 실패 (${response.status}): ${detail.slice(0, 200)}`)
  }

  const payload: unknown = await response.json()
  const items = (payload as { items?: unknown })?.items
  if (!Array.isArray(items)) {
    throw new Error('kosmart 응답에 items 배열이 없습니다.')
  }
  if (!items.every(isGrantItem)) {
    throw new Error('kosmart 응답 항목의 형식이 예상과 다릅니다.')
  }
  return items
}
