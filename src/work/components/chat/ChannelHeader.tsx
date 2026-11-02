'use client'

import {
  HashIcon,
  InfoIcon,
  LockIcon,
  MegaphoneIcon,
  PinIcon,
  ArrowUpToLineIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-work'
import { Button } from '@work/components/ui/button'
import NotifyLevelMenu from '@work/components/notifications/NotifyLevelMenu'
import type { ChannelDetail } from '@work/lib/channels/types'
import { notifyLevelOptions, type NotifyLevel } from '@work/lib/notifications/levels'
import { cn } from '@work/lib/utils'

export type ChannelHeaderProps = {
  channel: ChannelDetail
  memberCount: number
  onlineCount: number
  /** DM 상대 접속 여부 */
  peerOnline?: boolean
  isMember: boolean
  starred: boolean
  /** 알림 수준(모든 새 글/멘션만/끔). 끔이 기존 뮤트다 */
  notifyLevel: NotifyLevel
  onToggleStar?: () => void
  onChangeNotifyLevel?: (level: NotifyLevel) => void
  onOpenInfo: () => void
  onOpenPins: () => void
  pinCount: number
}

/** 채널 머리글: #이름 · 주제 · 멤버/접속 수 · 고정 · 즐겨찾기 · 알림 수준 · 정보 */
export default function ChannelHeader({
  channel,
  memberCount,
  onlineCount,
  peerOnline,
  isMember,
  starred,
  notifyLevel,
  onToggleStar,
  onChangeNotifyLevel,
  onOpenInfo,
  onOpenPins,
  pinCount,
}: ChannelHeaderProps) {
  const isGroup = channel.kind === 'dm' && channel.isGroup
  // 1:1 DM 만 isDm — 그룹은 멤버 단추가 있고 접속 표시는 없다
  const isDm = channel.kind === 'dm' && !isGroup
  const Icon = isDm
    ? UserIcon
    : isGroup
      ? UsersIcon
      : channel.kind === 'private'
        ? LockIcon
        : HashIcon
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-1.5">
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-1.5 text-base font-semibold">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{channel.name}</span>
          {channel.kind === 'private' && <span className="sr-only">(비공개 채널)</span>}
          {isGroup && <span className="sr-only">(그룹 채팅)</span>}
          {channel.postPolicy === 'owners' && channel.kind !== 'dm' && (
            <span
              className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"
              data-tooltip="소유자·관리자만 글을 올릴 수 있는 공지 채널입니다"
            >
              <MegaphoneIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">공지 채널 — 소유자·관리자만 글을 올릴 수 있습니다</span>
            </span>
          )}
          {isDm && (
            <span
              className={cn(
                'ml-1 shrink-0 text-xs font-normal whitespace-nowrap',
                peerOnline ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {peerOnline ? '접속 중' : '자리 비움'}
            </span>
          )}
          {channel.archived_at && (
            <span className="ml-1 shrink-0 rounded-w-md border px-1.5 text-xs font-normal whitespace-nowrap text-muted-foreground">
              보관됨
            </span>
          )}
        </h1>
        {channel.topic && (
          <p className="truncate text-xs text-muted-foreground" title={channel.topic}>
            {channel.topic}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isDm && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenInfo}
            aria-label={`멤버 ${memberCount}명, 접속 중 ${onlineCount}명 — 멤버 보기`}
          >
            <UsersIcon aria-hidden="true" />
            <span aria-hidden="true">{memberCount}</span>
            {onlineCount > 0 && (
              <span aria-hidden="true" className="text-xs text-primary">
                · {onlineCount}
              </span>
            )}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpenPins}
          // 모바일에서는 머리글 폭을 아끼려 숨기고 같은 동작을 정보 패널("내 설정")에 둔다
          className="hidden md:inline-flex"
          aria-label={`고정 메시지${pinCount > 0 ? ` ${pinCount}개` : ''}`}
        >
          <PinIcon aria-hidden="true" />
          {pinCount > 0 && <span aria-hidden="true">{pinCount}</span>}
        </Button>
        {isMember && onToggleStar && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleStar}
            className="hidden md:inline-flex"
            aria-pressed={starred}
            aria-label={starred ? '고정 해제' : '상단에 고정'}
          >
            <ArrowUpToLineIcon
              aria-hidden="true"
              className={cn(starred && 'fill-current text-primary')}
            />
          </Button>
        )}
        {isMember && onChangeNotifyLevel && (
          <span className="hidden md:inline-flex">
            <NotifyLevelMenu
              level={notifyLevel}
              options={notifyLevelOptions(channel.kind, isGroup)}
              onChange={onChangeNotifyLevel}
            />
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onOpenInfo}
          aria-label={isDm || isGroup ? '대화 정보' : '채널 정보'}
        >
          <InfoIcon aria-hidden="true" />
        </Button>
      </div>
    </header>
  )
}
