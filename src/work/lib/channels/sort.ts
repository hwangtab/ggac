/**
 * 채널 목록 정렬 방식(0030) — 순수 모듈(조회 없음).
 *   section : 카테고리별(기본, 화면 표기 "섹션별"). 고정 채널 → DB 카테고리(0044) 순서.
 *   recent  : 최근 활동순. 섹션 구분 없이 고정 채널 → 나머지, 각각 마지막 메시지 시각 내림차순.
 */
import { groupChannelsByCategory, type ChannelCategory } from './sections'

export const CHANNEL_SORTS = ['section', 'recent'] as const
export type ChannelSort = (typeof CHANNEL_SORTS)[number]

export const DEFAULT_CHANNEL_SORT: ChannelSort = 'section'

export const CHANNEL_SORT_LABEL: Record<ChannelSort, string> = {
  section: '섹션별',
  recent: '최근 활동순',
}

export function isChannelSort(value: unknown): value is ChannelSort {
  return typeof value === 'string' && (CHANNEL_SORTS as readonly string[]).includes(value)
}

/** 알 수 없는 값(옛 데이터·행 없음)은 기본값으로 */
export function parseChannelSort(value: unknown): ChannelSort {
  return isChannelSort(value) ? value : DEFAULT_CHANNEL_SORT
}

type Sortable = { name: string; lastActivityAt?: number }

/**
 * 최근 활동순: lastActivityAt 내림차순, 활동 없는 항목은 이름순으로 맨 뒤.
 * 입력을 바꾸지 않고 새 배열을 돌려준다.
 */
export function sortByRecentActivity<T extends Sortable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = a.lastActivityAt
    const tb = b.lastActivityAt
    if (ta !== undefined && tb !== undefined && ta !== tb) return tb - ta
    if (ta !== undefined && tb === undefined) return -1
    if (ta === undefined && tb !== undefined) return 1
    return a.name.localeCompare(b.name, 'ko')
  })
}

/** 최근 활동순 평면 목록: 고정 채널 먼저, 각각 최근 활동순 */
export function splitPinnedRecent<T extends Sortable & { starred: boolean }>(
  items: readonly T[]
): { pinned: T[]; rest: T[] } {
  return {
    pinned: sortByRecentActivity(items.filter(i => i.starred)),
    rest: sortByRecentActivity(items.filter(i => !i.starred)),
  }
}

/** 새 메시지가 왔을 때 lastActivityAt 을 올린다(내려가지 않는다). 바뀐 게 없으면 같은 배열 */
export function bumpActivity<T extends { id: string; lastActivityAt?: number }>(
  items: T[],
  bumps: ReadonlyMap<string, number>
): T[] {
  if (bumps.size === 0) return items
  let changed = false
  const next = items.map(item => {
    const at = bumps.get(item.id)
    if (at === undefined || (item.lastActivityAt !== undefined && item.lastActivityAt >= at)) {
      return item
    }
    changed = true
    return { ...item, lastActivityAt: at }
  })
  return changed ? next : items
}

export type ChannelPaneGroup<T> = { key: string; label: string; items: T[] }

/**
 * 자료실·할 일 목록 패널용 묶음. 섹션별이면 지금처럼 섹션 그룹, 최근 활동순이면 평면 목록 한 묶음
 * (고정 채널 먼저). 빈 입력은 빈 배열.
 */
export function groupChannelsForPane<
  T extends Sortable & { starred: boolean; categoryId?: string | null },
>(
  items: readonly T[],
  sort: ChannelSort,
  categories: readonly ChannelCategory[] = []
): ChannelPaneGroup<T>[] {
  if (sort !== 'recent') return groupChannelsByCategory(items, categories)
  if (items.length === 0) return []
  const { pinned, rest } = splitPinnedRecent(items)
  return [{ key: 'recent', label: CHANNEL_SORT_LABEL.recent, items: [...pinned, ...rest] }]
}

/**
 * 채팅(DM·그룹) 목록 정렬 방식(0031).
 *   recent : 최근 활동순(기본)
 *   name   : 이름순
 * 고정됨 묶음을 위로 올리는 건 화면(ChatsPaneContent)이 하고, 이 정렬은 각 묶음 안의 순서를 정한다.
 */
export const CHAT_SORTS = ['recent', 'name'] as const
export type ChatSort = (typeof CHAT_SORTS)[number]

export const DEFAULT_CHAT_SORT: ChatSort = 'recent'

export const CHAT_SORT_LABEL: Record<ChatSort, string> = {
  recent: '최근 활동순',
  name: '이름순',
}

export function isChatSort(value: unknown): value is ChatSort {
  return typeof value === 'string' && (CHAT_SORTS as readonly string[]).includes(value)
}

/** 알 수 없는 값(옛 데이터·행 없음)은 기본값으로 */
export function parseChatSort(value: unknown): ChatSort {
  return isChatSort(value) ? value : DEFAULT_CHAT_SORT
}

/** 채팅 목록 정렬(새 배열). 고정 분리는 하지 않는다 */
export function sortChats<T extends Sortable>(items: readonly T[], sort: ChatSort): T[] {
  if (sort === 'name') return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return sortByRecentActivity(items)
}
