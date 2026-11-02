import type { ChannelListItem } from './channel-items'

/**
 * 1:1 DM 항목에 상대의 접속 여부(`online`)를 붙인다(순수). 그룹·채널·상대를 모르는 DM 은 그대로 둔다 —
 * 그룹은 표시하지 않는다(설계 03 §1-3 N3). `peers` 는 DM 채널 id → 상대 user_id.
 */
export function withPresence(
  dms: ChannelListItem[],
  peers: Readonly<Record<string, string>> | undefined,
  online: ReadonlySet<string>
): ChannelListItem[] {
  if (!peers || online.size === 0) return dms
  let changed = false
  const out = dms.map(d => {
    if (d.kind !== 'dm' || d.group) return d
    const peer = peers[d.id]
    if (!peer || !online.has(peer)) return d
    changed = true
    return { ...d, online: true }
  })
  return changed ? out : dms
}
