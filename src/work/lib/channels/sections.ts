/**
 * 사이드바 채널 카테고리 분류 — 순수 모듈(조회 없음). 0044 부터 분류는 DB(work.channel_categories + channels.category_id)다.
 * 카테고리는 워크스페이스 공용, position 순. category_id 가 null 이거나 모르는 id 면 가상 카테고리 "기타"(맨 끝, 비면 숨김).
 * 카테고리 안 채널 순서는 이름순. docs/15.
 */
export type ChannelCategory = { id: string; name: string; position: number }

export const OTHER_CATEGORY = { key: 'other', label: '기타' } as const
/** 카테고리 이름 길이 한도(DB CHECK 와 같다) */
export const CATEGORY_NAME_MAX = 40

const BOT_PREFIX = 'ops-'

/** 운영 봇(경보 전용) 채널인가 — 이름 앞에 봇 표시를 붙인다 */
export function isBotChannel(slug: string | null | undefined): boolean {
  return !!slug && slug.startsWith(BOT_PREFIX)
}

/** 카테고리 이름(⌘K 보조 텍스트 등). DM(slug 없음)은 null */
export function categoryLabelOf(
  item: { slug: string | null; categoryId?: string | null },
  categories: readonly ChannelCategory[]
): string | null {
  if (!item.slug) return null
  const found = item.categoryId ? categories.find(c => c.id === item.categoryId) : undefined
  return found?.name ?? OTHER_CATEGORY.label
}

/** key = 카테고리 id, 기타는 'other'(id 는 null) */
export type ChannelCategoryGroup<T> = {
  key: string
  id: string | null
  label: string
  items: T[]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko')

function sortedCategories(categories: readonly ChannelCategory[]): ChannelCategory[] {
  return [...categories].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ko')
  )
}

/**
 * 채널을 카테고리별로 묶는다. 카테고리는 position(같으면 이름) 순, 기타는 맨 끝.
 * 기본은 빈 카테고리를 만들지 않는다 — includeEmpty(관리자: 끌어다 놓을 자리)면 빈 카테고리도 둔다.
 * 기타는 비면 항상 숨긴다.
 */
export function groupChannelsByCategory<T extends { name: string; categoryId?: string | null }>(
  items: readonly T[],
  categories: readonly ChannelCategory[],
  opts: { includeEmpty?: boolean } = {}
): ChannelCategoryGroup<T>[] {
  const ordered = sortedCategories(categories)
  const known = new Set(ordered.map(c => c.id))
  const groups: ChannelCategoryGroup<T>[] = ordered.map(c => ({
    key: c.id,
    id: c.id,
    label: c.name,
    items: items.filter(i => i.categoryId === c.id).sort(byName),
  }))
  groups.push({
    key: OTHER_CATEGORY.key,
    id: null,
    label: OTHER_CATEGORY.label,
    items: items.filter(i => !i.categoryId || !known.has(i.categoryId)).sort(byName),
  })
  return groups.filter(g => g.items.length > 0 || (!!opts.includeEmpty && g.id !== null))
}

/** 카테고리 순서를 한 칸 옮긴 id 배열. 경계 밖이거나 없는 id 면 null */
export function reorderedCategoryIds(
  categories: readonly ChannelCategory[],
  id: string,
  direction: 'up' | 'down'
): string[] | null {
  const ids = sortedCategories(categories).map(c => c.id)
  const from = ids.indexOf(id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from === -1 || to < 0 || to >= ids.length) return null
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  return ids
}

/** 머리글 끌어다 놓기: fromId 를 toId 앞에 놓은 id 배열. 같거나 없는 id 면 null */
export function moveCategoryBefore(
  categories: readonly ChannelCategory[],
  fromId: string,
  toId: string
): string[] | null {
  if (fromId === toId) return null
  const ids = sortedCategories(categories).map(c => c.id)
  if (!ids.includes(fromId) || !ids.includes(toId)) return null
  const without = ids.filter(i => i !== fromId)
  without.splice(without.indexOf(toId), 0, fromId)
  return without
}

/** ids 순서대로 position 0.. 을 다시 매긴 새 배열(낙관적 갱신용). ids 에 없는 카테고리는 뒤에 이어 붙인다 */
export function applyCategoryOrder(
  categories: readonly ChannelCategory[],
  ids: readonly string[]
): ChannelCategory[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  const listed = ids.flatMap(id => byId.get(id) ?? [])
  const rest = sortedCategories(categories).filter(c => !ids.includes(c.id))
  return [...listed, ...rest].map((c, i) => ({ ...c, position: i }))
}
