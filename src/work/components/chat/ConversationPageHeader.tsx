import { HashIcon, LockIcon, UserIcon, UsersIcon } from 'lucide-work'
import type { ChannelDetail } from '@work/lib/channels/types'

function KindIcon({ channel }: { channel: ChannelDetail }) {
  const cls = 'size-4 shrink-0 text-muted-foreground'
  if (channel.kind === 'dm') {
    return channel.isGroup ? (
      <UsersIcon aria-hidden="true" className={cls} />
    ) : (
      <UserIcon aria-hidden="true" className={cls} />
    )
  }
  return channel.kind === 'private' ? (
    <LockIcon aria-hidden="true" className={cls} />
  ) : (
    <HashIcon aria-hidden="true" className={cls} />
  )
}

/**
 * 탭 화면(파일·공유됨·추가 탭)의 가벼운 머리글 — 대화 종류 아이콘 + 이름.
 * 멤버·핀·정보 같은 도구는 게시물(채팅) 탭의 ChannelHeader 가 맡는다.
 */
export default function ConversationPageHeader({ channel }: { channel: ChannelDetail }) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-1.5">
      <h1 className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
        <KindIcon channel={channel} />
        <span className="truncate">{channel.name}</span>
        {channel.kind === 'private' && <span className="sr-only">(비공개 채널)</span>}
        {channel.kind === 'dm' && channel.isGroup && <span className="sr-only">(그룹 채팅)</span>}
      </h1>
    </header>
  )
}
