'use client'

import type { ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import {
  BookmarkIcon,
  CheckSquareIcon,
  CopyIcon,
  ForwardIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  PinIcon,
  QuoteIcon,
  Trash2Icon,
} from 'lucide-work'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@work/components/ui/sheet'
import { REACTION_EMOJIS, emojiLabel } from '@work/lib/messages/emoji'
import { cn } from '@work/lib/utils'

/**
 * 터치 기기의 메시지 작업 시트(하단). hover 전용 작업 막대를 대신해, 메시지를 길게 누르거나 ⋯ 를 누르면 열린다.
 * 막대와 같은 동작 전부: 반응 · 스레드 답글 · 인용 · 전달 · 북마크 · 고정 · 할 일로 만들기 · 고치기 · 복사 · 삭제.
 * 각 항목은 누르면 시트를 닫는다. 포커스 가두기·Esc·바깥 누르기 닫기는 Sheet(base-ui Dialog)가 맡는다.
 */
export type MessageActionSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 시트 제목에 쓰는 작성자 이름 */
  authorName: string
  onReact?: (emoji: string) => void
  onOpenThread?: () => void
  /** 인용하여 답장(0028) */
  onQuote?: () => void
  /** 다른 대화로 전달(0028) */
  onForward?: () => void
  onToggleBookmark?: () => void
  bookmarked?: boolean
  onTogglePin?: () => void
  pinned?: boolean
  /** 할 일로 만들기 링크(텍스트 메시지만) */
  taskHref?: string
  onEdit?: () => void
  onCopy?: () => void
  onDelete?: () => void
}

const ITEM =
  'flex h-11 w-full items-center gap-3 rounded-w-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

function Item({
  icon,
  children,
  onClick,
  destructive,
  pressed,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  destructive?: boolean
  pressed?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        className={cn(ITEM, destructive && 'text-destructive')}
      >
        <span aria-hidden="true" className="flex size-5 items-center justify-center">
          {icon}
        </span>
        {children}
      </button>
    </li>
  )
}

export default function MessageActionSheet({
  open,
  onOpenChange,
  authorName,
  onReact,
  onOpenThread,
  onQuote,
  onForward,
  onToggleBookmark,
  bookmarked = false,
  onTogglePin,
  pinned = false,
  taskHref,
  onEdit,
  onCopy,
  onDelete,
}: MessageActionSheetProps) {
  const close = () => onOpenChange(false)
  const run = (fn: () => void) => () => {
    close()
    fn()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] gap-0 overflow-y-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="px-3 pt-2 pb-1 text-sm font-semibold">
          {authorName}의 메시지 작업
        </SheetTitle>
        <SheetDescription className="sr-only">
          반응을 달거나 답글·인용·전달·북마크·고정·고치기·삭제 같은 작업을 고릅니다. Esc 로
          닫습니다.
        </SheetDescription>

        {onReact && (
          <ul aria-label="반응 추가" className="grid grid-cols-6 gap-1 px-1 pb-2">
            {REACTION_EMOJIS.map(emoji => (
              <li key={emoji}>
                <button
                  type="button"
                  aria-label={emojiLabel(emoji)}
                  onClick={run(() => onReact(emoji))}
                  className="flex h-11 w-full items-center justify-center rounded-w-md text-xl outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {emoji}
                </button>
              </li>
            ))}
          </ul>
        )}

        <ul aria-label="메시지 작업" className="border-t pt-1">
          {onOpenThread && (
            <Item icon={<MessageSquareReplyIcon className="size-5" />} onClick={run(onOpenThread)}>
              스레드에 답글
            </Item>
          )}
          {onQuote && (
            <Item icon={<QuoteIcon className="size-5" />} onClick={run(onQuote)}>
              인용하여 답장
            </Item>
          )}
          {onForward && (
            <Item icon={<ForwardIcon className="size-5" />} onClick={run(onForward)}>
              다른 대화로 전달
            </Item>
          )}
          {onToggleBookmark && (
            <Item
              icon={<BookmarkIcon className={cn('size-5', bookmarked && 'fill-current')} />}
              pressed={bookmarked}
              onClick={run(onToggleBookmark)}
            >
              {bookmarked ? '북마크 해제' : '북마크'}
            </Item>
          )}
          {onTogglePin && (
            <Item icon={<PinIcon className="size-5" />} onClick={run(onTogglePin)}>
              {pinned ? '고정 해제' : '채널에 고정'}
            </Item>
          )}
          {taskHref && (
            <li>
              <Link href={taskHref} onClick={close} className={ITEM}>
                <span aria-hidden="true" className="flex size-5 items-center justify-center">
                  <CheckSquareIcon className="size-5" />
                </span>
                할 일로 만들기
              </Link>
            </li>
          )}
          {onEdit && (
            <Item icon={<PencilIcon className="size-5" />} onClick={run(onEdit)}>
              메시지 고치기
            </Item>
          )}
          {onCopy && (
            <Item icon={<CopyIcon className="size-5" />} onClick={run(onCopy)}>
              본문 복사
            </Item>
          )}
          {onDelete && (
            <Item icon={<Trash2Icon className="size-5" />} destructive onClick={run(onDelete)}>
              메시지 삭제
            </Item>
          )}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
