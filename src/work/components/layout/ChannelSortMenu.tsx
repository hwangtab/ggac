'use client'

import { ArrowDownUpIcon } from 'lucide-work'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import {
  CHANNEL_SORTS,
  CHANNEL_SORT_LABEL,
  CHAT_SORTS,
  CHAT_SORT_LABEL,
  isChannelSort,
  isChatSort,
  type ChannelSort,
  type ChatSort,
} from '@work/lib/channels/sort'
import { cn } from '@work/lib/utils'
import { PANE_ACTION_CLASS } from './pane-styles'

type SortMenuProps<T extends string> = {
  /** 메뉴 제목·트리거 접두 ("채널 정렬" 등) */
  title: string
  options: readonly T[]
  labels: Record<T, string>
  isValid: (value: unknown) => value is T
  sort: T
  onChange: (sort: T) => void
  className?: string
}

/** 정렬 라디오 메뉴 공통 본체 — 순수 컴포넌트, 저장은 onChange 가 한다 */
function SortMenu<T extends string>({
  title,
  options,
  labels,
  isValid,
  sort,
  onChange,
  className,
}: SortMenuProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${title}: ${labels[sort]}`}
        className={cn(PANE_ACTION_CLASS, className)}
      >
        <ArrowDownUpIcon aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={next => {
              if (isValid(next) && next !== sort) onChange(next)
            }}
          >
            {options.map(opt => (
              <DropdownMenuRadioItem key={opt} value={opt}>
                {labels[opt]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 채널 목록 정렬 메뉴(섹션별 / 최근 활동순) — 데스크톱 패널 머리글과 모바일 `/c` 화면이 함께 쓴다.
 * `className` 으로 배경이 다른 모바일 화면에서 색을 덮어쓴다.
 */
export default function ChannelSortMenu({
  sort,
  onChange,
  className,
}: {
  sort: ChannelSort
  onChange: (sort: ChannelSort) => void
  className?: string
}) {
  return (
    <SortMenu
      title="채널 정렬"
      options={CHANNEL_SORTS}
      labels={CHANNEL_SORT_LABEL}
      isValid={isChannelSort}
      sort={sort}
      onChange={onChange}
      className={className}
    />
  )
}

/** 채팅(DM·그룹) 목록 정렬 메뉴(최근 활동순 / 이름순) — 데스크톱 패널 머리글과 모바일 `/chat` 화면 */
export function ChatSortMenu({
  sort,
  onChange,
  className,
}: {
  sort: ChatSort
  onChange: (sort: ChatSort) => void
  className?: string
}) {
  return (
    <SortMenu
      title="채팅 정렬"
      options={CHAT_SORTS}
      labels={CHAT_SORT_LABEL}
      isValid={isChatSort}
      sort={sort}
      onChange={onChange}
      className={className}
    />
  )
}
