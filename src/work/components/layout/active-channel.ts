import type { ChannelListItem } from './channel-items'

/** 현재 경로(/c/<slug>, /dm/<id>)에 해당하는 항목 id. 없으면 null. */
export function activeChannelId(pathname: string, items: ChannelListItem[]): string | null {
  const channel = /^\/c\/([^/]+)/.exec(pathname)
  if (channel) {
    const slug = decodeURIComponent(channel[1])
    return items.find(i => i.kind !== 'dm' && i.slug === slug)?.id ?? null
  }
  const dm = /^\/dm\/([^/]+)/.exec(pathname)
  if (dm) return items.find(i => i.kind === 'dm' && i.id === dm[1])?.id ?? null
  return null
}
