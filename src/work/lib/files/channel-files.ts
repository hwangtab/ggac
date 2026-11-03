import { z } from 'zod'
import { childFolder, parseFolderParam } from './folders'
import type { FileListItem } from './queries'

/** 채널 파일 탭 한 페이지 크기 */
export const CHANNEL_FILES_PAGE_SIZE = 100

export const CHANNEL_FILE_SORT_KEYS = ['name', 'date', 'size'] as const
export type ChannelFileSortKey = (typeof CHANNEL_FILE_SORT_KEYS)[number]

export type ChannelFilesSearch = {
  /** 파일명 검색어(있으면 폴더와 무관하게 채널 전체에서 찾는다) */
  q?: string
  /** 현재 폴더(루트 ''). 잘못된 값은 루트로 돌린다 */
  path: string
  sort: ChannelFileSortKey
  dir: 'asc' | 'desc'
  page: number
  /** 'all' 이면 이전 버전도 보인다(0032). 기본은 계보당 최신 1개 */
  versions?: 'all'
}

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  sort: z.enum(CHANNEL_FILE_SORT_KEYS).catch('name'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  versions: z.literal('all').optional().catch(undefined),
})

/** 파일 탭 쿼리스트링(`?path=&q=&sort=&dir=&page=`) → 검색 조건. 배열은 첫 값, 잘못된 값은 기본값. */
export function parseChannelFilesSearch(
  raw: Record<string, string | string[] | undefined>
): ChannelFilesSearch {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const parsed = searchSchema.parse({
    q: first(raw.q) || undefined,
    sort: first(raw.sort),
    dir: first(raw.dir),
    page: first(raw.page),
    versions: first(raw.versions) || undefined,
  })
  // ggac 이식: strict false 에서는 zod 결과의 키가 전부 선택형으로 추론된다(catch 로 늘 채워지므로 단언한다)
  return { ...(parsed as Omit<ChannelFilesSearch, 'path'>), path: parseFolderParam(raw.path) ?? '' }
}

/**
 * 파일 탭 링크. base 는 `/c/<slug>` 또는 `/dm/<id>`. 기본값(루트·이름순·오름차순·1쪽)은 생략한다.
 * path 는 URLSearchParams 가 인코딩한다(한글·공백·`&`·`#` 안전).
 */
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

export type ChannelFolder = { name: string; path: string; fileCount: number }

/**
 * 전역 자료실(`/files`)의 폴더 탐색 링크. 기본값(루트·이름순·오름차순·1쪽)은 생략한다.
 * 채널 파일 탭의 channelFilesHref 와 같은 규칙이다(path 는 URLSearchParams 가 인코딩).
 */
export function filesFolderHref(
  channelId: string,
  s: Partial<Pick<ChannelFilesSearch, 'path' | 'sort' | 'dir' | 'page' | 'versions'>> = {}
): string {
  const p = new URLSearchParams({ channel: channelId })
  if (s.path) p.set('path', s.path)
  if (s.sort && s.sort !== 'name') p.set('sort', s.sort)
  if (s.dir && s.dir !== 'asc') p.set('dir', s.dir)
  if (s.page && s.page > 1) p.set('page', String(s.page))
  if (s.versions === 'all') p.set('versions', 'all')
  return `/files?${p.toString()}`
}

const collator = new Intl.Collator('ko')

/** RPC `channel_subfolders` 행 → 폴더 목록(빈 이름 행 제외, 이름순). parent 는 조회한 폴더 경로 */
export function toChannelFolders(
  rows: { name: string; file_count: number | string }[],
  parent: string
): ChannelFolder[] {
  return rows
    .filter(f => f.name !== '')
    .map(f => ({
      name: f.name,
      path: childFolder(parent, f.name),
      fileCount: Number(f.file_count),
    }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

export type ChannelFilesData = {
  items: FileListItem[]
  /** 여기까지 확인된 개수(hasMore 가 false 일 때만 전체 수) */
  total: number
  /** 다음 쪽이 있는가 */
  hasMore: boolean
  pageSize: number
  /** 현재 폴더의 하위 폴더(검색 중이거나 2쪽 이후면 빈 목록) */
  folders: ChannelFolder[]
}
