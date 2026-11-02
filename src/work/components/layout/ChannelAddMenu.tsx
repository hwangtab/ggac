'use client'

import Link from '@work/lib/nav/link'
import { PlusIcon } from 'lucide-work'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { cn } from '@work/lib/utils'
import { PANE_ACTION_CLASS } from './pane-styles'

/**
 * 채널 목록 패널 머리글의 `+` 메뉴(docs/15 §1-2): "새 채널 만들기"(대화상자) / "채널 찾아보기"(`/c`).
 * 대화상자 상태는 호출한 쪽이 가진다 — 메뉴가 닫히며 대화상자가 함께 사라지지 않게.
 */
export default function ChannelAddMenu({
  onCreate,
  className,
}: {
  onCreate: () => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="채널 추가"
        className={cn(PANE_ACTION_CLASS, 'min-w-7 justify-center', className)}
      >
        <PlusIcon aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={onCreate}>새 채널 만들기</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/c" />}>채널 찾아보기</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
