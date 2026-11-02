/**
 * ggac 이식 1b 자리표시 — 원본 `lib/files/channel-files.ts`에서 채팅 화면(SystemMessage)이 쓰는 링크 함수만 둔다.
 * 2단계(자료실)에서 원본 전체로 바꾼다(`port-from-kosmart.mjs --force`).
 */
export type ChannelFilesSearch = {
  q?: string
  path: string
  sort: 'name' | 'date' | 'size'
  dir: 'asc' | 'desc'
  page: number
  versions?: 'all'
}

/** 파일 탭 링크. base 는 `/board-room/c/<slug>` 또는 `/board-room/dm/<id>`. 기본값은 생략한다. */
export function channelFilesHref(base: string, s: Partial<ChannelFilesSearch> = {}): string {
  const p = new URLSearchParams()
  if (s.path) p.set('path', s.path)
  if (s.q) p.set('q', s.q)
  if (s.sort && s.sort !== 'name') p.set('sort', s.sort)
  if (s.dir && s.dir !== 'asc') p.set('dir', s.dir)
  if (s.page && s.page > 1) p.set('page', String(s.page))
  if (s.versions === 'all') p.set('versions', 'all')
  const qs = p.toString()
  return `${base}/files${qs ? `?${qs}` : ''}`
}
