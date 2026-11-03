import { getSearchLineageInfo, type ReadableScope } from '@/db/queries/work/search'

/**
 * 검색 결과의 문서 버전 처리(0032). 파일명·문서 내용 검색은 첨부(버전) 단위라 같은 문서의 모든 버전이 한꺼번에 나온다.
 * 같은 계보(version_root_id)는 한 건으로 묶고, 최신 버전이 맞았으면 그것을, 아니면 가장 위 순위의 이전 버전을
 * "이전 버전 vN" 표시와 함께 남긴다. 읽을 수 없는 첨부는 정보가 없어 그대로 둔다.
 *
 * ggac 이식: 첫 인자가 RLS 클라이언트 대신 읽기 범위(`readable`)다 — 쿼리 계층이 그 범위 안의 첨부만 읽는다.
 */

export type LineageInfo = { root: string; versionNo: number; isLatest: boolean }

/** 첨부 id → 계보 정보. 조회가 실패하면 묶지 않고(빈 맵) 로그만 남긴다 — 검색 전체를 막지 않는다 */
export async function loadLineageInfo(
  readable: ReadableScope,
  ids: readonly string[]
): Promise<Map<string, LineageInfo>> {
  try {
    return await getSearchLineageInfo(ids, readable)
  } catch (e) {
    console.error('[search] 첨부 버전 정보 조회 실패, 버전 묶기 생략:', e)
    return new Map()
  }
}

/**
 * 같은 계보의 결과를 한 건으로 묶는다(처음 나온 순서 유지). 계보 안에 최신 버전 결과가 있으면 그것을 쓰고,
 * 없으면 가장 위 순위의 이전 버전을 `oldVersionNo` 와 함께 남긴다.
 */
export function collapseByLineage<T extends { id: string }>(
  rows: readonly T[],
  info: ReadonlyMap<string, LineageInfo>
): Array<T & { oldVersionNo?: number }> {
  const order: string[] = []
  const best = new Map<string, T & { oldVersionNo?: number }>()
  for (const row of rows) {
    const li = info.get(row.id)
    const key = li ? li.root : row.id
    const current = best.get(key)
    if (!current) {
      order.push(key)
      best.set(key, li && !li.isLatest ? { ...row, oldVersionNo: li.versionNo } : { ...row })
    } else if (current.oldVersionNo !== undefined && li?.isLatest) {
      best.set(key, { ...row })
    }
  }
  return order.map(k => best.get(k) as T & { oldVersionNo?: number })
}
