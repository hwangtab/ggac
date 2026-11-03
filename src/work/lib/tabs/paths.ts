import type { ChannelKind } from '@work/lib/channels/types'

/**
 * 대화 탭 경로 규약(순수). 채널 `/c/<slug>`, DM·그룹 `/dm/<id>` 가 기본 경로이고
 * 탭은 그 아래 `<base>/<key>` — 기본 탭 `files`·`shared`, 추가 탭 `t/<tabId>`.
 */

/** 대화 기본 경로: 채널 `/c/<slug>`, DM·그룹 `/dm/<id>` */
export function conversationBasePath(c: {
  id: string
  kind: ChannelKind
  slug: string | null
}): string {
  return c.kind === 'dm' || !c.slug ? `/dm/${c.id}` : `/c/${c.slug}`
}

/** 탭 하나의 주소 — 'posts' 는 기본 경로, 그 밖의 키는 `<기본 경로>/<key>` */
export function conversationTabHref(base: string, key: string): string {
  return key === 'posts' ? base : `${base}/${key}`
}

/** 추가 탭의 탭 키(`t/<id>`) — 탭 바 activeKey 와 주소 조각 */
export function customTabKey(tabId: string): string {
  return `t/${tabId}`
}
