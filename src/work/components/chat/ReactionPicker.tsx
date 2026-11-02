'use client'

import { SmilePlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { REACTION_EMOJIS, emojiLabel } from '@work/lib/messages/emoji'

/** 고정 12종 반응 피커(메뉴). 다른 이모지는 본문에 유니코드로 직접 입력한다 */
export default function ReactionPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="반응 추가"
            disabled={disabled}
          />
        }
      >
        <SmilePlusIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="grid w-auto min-w-0 grid-cols-6 gap-0.5 p-1">
        {REACTION_EMOJIS.map(emoji => (
          <DropdownMenuItem
            key={emoji}
            aria-label={emojiLabel(emoji)}
            onClick={() => onPick(emoji)}
            className="justify-center px-1 text-lg"
          >
            {emoji}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
