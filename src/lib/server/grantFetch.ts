/**
 * kosmart 공고 API 호출. **네트워크 경계만** 담당한다 — 판정은
 * `src/lib/server/grantDigest.ts`가 하고 여기는 가져오기만 한다.
 */
import type { GrantItem } from '@/db/queries/grantDigests'
import { WINDOW_DAYS } from '@/lib/server/grantDigest'

/** 장르 하나당 요청 상한. API의 MAX_LIMIT(100)을 넘지 않는다. */
const PER_GENRE_LIMIT = 100

export interface FetchScope {
  genres: string[]
  regions: string[]
}

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

/** 장르 하나를 조회한다. 실패하면 어느 장르에서 실패했는지를 담아 던진다. */
async function fetchGenre(base: string, token: string, regionsParam: string, genre: string) {
  const url = new URL(base)
  url.searchParams.set('genres', genre)
  url.searchParams.set('regions', regionsParam)
  url.searchParams.set('days', String(WINDOW_DAYS))
  url.searchParams.set('limit', String(PER_GENRE_LIMIT))
  url.searchParams.set('strictRegion', 'true')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `kosmart 공고 조회 실패 (장르 ${genre}, ${response.status}): ${detail.slice(0, 200)}`
    )
  }
  const payload: unknown = await response.json()
  const items = (payload as { items?: unknown })?.items
  if (!Array.isArray(items)) {
    throw new Error(`kosmart 응답에 items 배열이 없습니다 (장르 ${genre}).`)
  }
  if (!items.every(isGrantItem)) {
    throw new Error(`kosmart 응답 항목의 형식이 예상과 다릅니다 (장르 ${genre}).`)
  }
  return items as GrantItem[]
}

/**
 * kosmart에서 공고를 받아온다. **장르 하나당 한 번씩, 병렬로 호출한다.**
 *
 * 왜 나눠 부르나: API의 `limit` 상한이 100인데, 실측(2026-09-01)으로 경기·서울 ×
 * 음악·시각예술·다원예술이 벌써 93건이다. 조합원이 관심 장르를 넓힐수록 한 번의 호출로는
 * 천장에 닿고, 잘린 뒷부분은 **에러 없이 사라진다**. 장르 하나씩이면 각 호출이 그 장르의
 * 공고 수만큼만 되므로 조합원이 몇 명이 되든 잘리지 않는다.
 *
 * 왜 병렬인가: `STANDARD_GENRES`는 10종이고 합집합은 조합원 관심사가 다양해질수록
 * 커진다 — 순차로 부르면 각 호출의 `AbortSignal.timeout(20_000)`이 그대로 누적돼
 * 장르 4종만 돼도 함수 시간 한도를 넘길 수 있다. `Promise.all`을 쓰면 전체 대기 시간이
 * "가장 느린 호출 하나"로 수렴한다. `allSettled`를 쓰지 않는다 — 하나라도 실패하면
 * 풀이 불완전하므로 던지는 게 맞고, `Promise.all`의 첫 reject 즉시 reject가 그 의미와
 * 맞는다.
 *
 * **중복 제거는 순서에 의존하지 않는다.** 병렬 호출 결과가 한꺼번에 배열로 오므로,
 * `scope.genres` 순서대로 결과를 이어붙인 뒤 `key`로 중복을 제거한다(같은 공고가 여러
 * 장르 태그를 달고 있으면 각 호출에 겹쳐 온다 — 예:「연극·무용·음악 통합공모」). kosmart가
 * 장르마다 점수순으로 정렬해 보내므로 장르 순서를 그대로 보존하는 것이 결과의 예측
 * 가능성에 중요하다(먼저 요청한 장르의 상위권이 뒤 장르의 하위권보다 앞선다).
 *
 * @throws 환경변수 누락·HTTP 실패·응답 형식 오류는 전부 던진다. 호출부가 관리자에게 알린다 —
 *   조용히 빈 배열을 돌려주면 "이번 주는 공고가 없었다"와 구분되지 않는다.
 */
export async function fetchGrantOpportunities(scope: FetchScope): Promise<GrantItem[]> {
  const base = process.env.KOSMART_OPPORTUNITIES_URL
  const token = process.env.KOSMART_API_TOKEN
  if (!base) throw new Error('KOSMART_OPPORTUNITIES_URL이 설정되지 않았습니다.')
  if (!token) throw new Error('KOSMART_API_TOKEN이 설정되지 않았습니다.')
  if (scope.genres.length === 0) throw new Error('요청할 장르가 비어 있습니다.')

  const regionsParam = scope.regions.join(',')
  const byGenre = await Promise.all(
    scope.genres.map(genre => fetchGenre(base, token, regionsParam, genre))
  )

  const seen = new Set<string>()
  const out: GrantItem[] = []
  for (const items of byGenre) {
    for (const it of items) {
      if (seen.has(it.key)) continue
      seen.add(it.key)
      out.push(it)
    }
  }

  return out
}
