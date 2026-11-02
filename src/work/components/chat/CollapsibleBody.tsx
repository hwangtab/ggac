'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'

/** 이 줄 수를 넘는 본문은 처음에 접어서 보인다(QA #20) */
export const COLLAPSE_LINES = 20

/** 원문(마크다운) 줄 수로 긴 본문인지 판단한다 — 렌더 높이를 재지 않아 첫 화면이 흔들리지 않는다 */
export function isLongBody(body: string, lines = COLLAPSE_LINES): boolean {
  let n = 1
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) === 10 && ++n > lines) return true
  }
  return false
}

/**
 * 긴 메시지 본문 접기 — 20줄을 넘으면 높이를 줄여 보이고 "더 보기"로 펼친다.
 * 접힌 동안에도 내용은 DOM 에 있어 검색(⌘F)·스크린리더가 읽을 수 있다.
 */
export default function CollapsibleBody({ body, children }: { body: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  if (!isLongBody(body)) return <>{children}</>
  return (
    <div>
      <div
        id={id}
        className={cn('relative', !expanded && 'max-h-[26rem] overflow-hidden')}
        data-collapsed={expanded ? undefined : 'true'}
      >
        {children}
        {!expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(v => !v)}
        className="mt-0.5 inline-flex items-center gap-0.5 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? (
          <>
            <ChevronUpIcon aria-hidden="true" className="size-3.5" />
            접기
          </>
        ) : (
          <>
            <ChevronDownIcon aria-hidden="true" className="size-3.5" />더 보기
          </>
        )}
      </button>
    </div>
  )
}
