import { XIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'

/**
 * 선택된 항목 칩 줄(사람 고르기 등) — 칩 하나 = 이름 + 해제 버튼(`size-5` 원형).
 * 새 채팅 `NewChatPicker`·`MemberPicker`(채널 만들기·초대)가 같은 칩을 쓴다. 해제 버튼 이름은 `<이름> 선택 해제`.
 */
export type ChipItem = { id: string; label: string }

export default function RemovableChips({
  items,
  onRemove,
  ariaLabel,
  disabled = false,
  className,
}: {
  items: ChipItem[]
  onRemove: (id: string) => void
  /** 목록 이름("선택한 사람" 등) */
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <ul aria-label={ariaLabel} className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map(item => (
        <li
          key={item.id}
          className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs"
        >
          {item.label}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(item.id)}
            aria-label={`${item.label} 선택 해제`}
            className="relative inline-flex size-5 items-center justify-center rounded-full outline-none pointer-coarse:after:absolute pointer-coarse:after:-inset-3 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}
