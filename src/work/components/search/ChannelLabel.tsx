import { HashIcon, LockIcon, UserIcon } from 'lucide-work'
import { chatKindLabel } from '@work/lib/channels/group'
import type { ChannelRef } from '@work/lib/search/search'

/** 검색 결과 항목의 채널 표시(아이콘 + 이름). 서버·클라이언트 컴포넌트 모두에서 쓴다. */
export default function ChannelLabel({ channel }: { channel: ChannelRef | null }) {
  if (!channel) return <span>알 수 없는 채널</span>
  if (channel.kind === 'dm') {
    return (
      <span className="inline-flex items-center gap-1">
        <UserIcon aria-hidden="true" className="size-3" />
        {chatKindLabel(channel.name)}
      </span>
    )
  }
  const Icon = channel.kind === 'private' ? LockIcon : HashIcon
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3" />
      {channel.name}
    </span>
  )
}
