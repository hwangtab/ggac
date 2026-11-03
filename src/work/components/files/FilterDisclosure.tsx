'use client'

import { useId, useState } from 'react'
import { ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'

/**
 * 모바일(<768px)에서 필터 묶음을 "필터" 버튼 뒤로 접는다(활성 필터 수 표시). md 이상에서는 늘 펼쳐 보인다.
 * 접혀 있어도 내용은 DOM 에 있어(hidden 클래스) GET 폼 제출 값에는 그대로 실린다.
 */
export default function FilterDisclosure({
  activeCount,
  children,
}: {
  activeCount: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(v => !v)}
        className="inline-flex h-8 pointer-coarse:h-11 items-center gap-1.5 self-start rounded-w-lg border px-3 text-sm outline-none hover:bg-accent md:hidden"
      >
        <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
        필터
        {activeCount > 0 && (
          <span className="rounded-w-lg bg-primary px-1.5 text-xs leading-5 text-primary-foreground">
            <span className="sr-only">적용 중 </span>
            {activeCount}
          </span>
        )}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      <div id={id} className={cn(!open && 'hidden', 'md:block')}>
        {children}
      </div>
    </div>
  )
}
