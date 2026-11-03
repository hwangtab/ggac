'use client'

import { AtSignIcon, BellIcon, BellOffIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
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
  NOTIFY_LEVEL_HINT,
  NOTIFY_LEVEL_LABEL,
  isNotifyLevel,
  type NotifyLevel,
} from '@work/lib/notifications/levels'

const LEVEL_ICON = { all: BellIcon, mentions: AtSignIcon, off: BellOffIcon } as const

/**
 * 채널 머리글의 알림 수준 메뉴(모든 새 글 / 멘션만 / 끔). 순수 컴포넌트 — 저장은 onChange 가 한다.
 * 끔은 기존 뮤트와 같다(사이드바 배지가 흐려진다).
 */
export default function NotifyLevelMenu({
  level,
  options,
  onChange,
  disabled,
}: {
  level: NotifyLevel
  options: readonly NotifyLevel[]
  onChange: (level: NotifyLevel) => void
  disabled?: boolean
}) {
  const Icon = LEVEL_ICON[level]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`알림 설정: ${NOTIFY_LEVEL_LABEL[level]}`}
          />
        }
      >
        <Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>이 대화의 알림</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={level}
            onValueChange={next => {
              if (isNotifyLevel(next) && next !== level) onChange(next)
            }}
          >
            {options.map(opt => (
              <DropdownMenuRadioItem key={opt} value={opt} className="flex-col items-start gap-0">
                <span>{NOTIFY_LEVEL_LABEL[opt]}</span>
                <span className="text-xs text-muted-foreground">{NOTIFY_LEVEL_HINT[opt]}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
