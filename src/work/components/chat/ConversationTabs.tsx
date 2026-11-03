'use client'

import type { ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import { ChevronDownIcon } from 'lucide-work'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import {
  SUB_NAV_BAR_CLASS,
  SUB_NAV_LIST_CLASS,
  subNavItemClass,
} from '@work/components/layout/sub-nav'
import { cn } from '@work/lib/utils'
import type { ConversationTab } from './conversation-tabs'

/** 데스크톱에서 이 개수를 넘으면 나머지를 "더 보기 ▾" 메뉴로 접는다(docs/05 §3) */
export const MAX_VISIBLE_TABS = 6

/**
 * 보이는 탭과 접히는 탭으로 나눈다. 현재 탭은 접히더라도 항상 보인다(맨 뒤 보이는 자리와 바꾼다).
 */
export function splitVisibleTabs(
  tabs: readonly ConversationTab[],
  activeKey: string,
  max = MAX_VISIBLE_TABS
): { visible: ConversationTab[]; overflow: ConversationTab[] } {
  if (tabs.length <= max) return { visible: [...tabs], overflow: [] }
  const visible = tabs.slice(0, max)
  const overflow = tabs.slice(max)
  const activeIdx = overflow.findIndex(t => t.key === activeKey)
  if (activeIdx >= 0) {
    const [active] = overflow.splice(activeIdx, 1)
    const [bumped] = visible.splice(max - 1, 1, active)
    overflow.unshift(bumped)
  }
  return { visible, overflow }
}

/**
 * 대화 상단 가로 탭 바. 탭은 링크이고 현재 탭에 aria-current="page".
 * - `renderMenu`: 추가 탭 옆의 ⋯ 메뉴(이름 바꾸기 등)를 꽂는 자리(기본 탭은 호출부가 null 을 돌려준다).
 * - `trailing`: 마지막 탭(·더 보기) 바로 뒤 "＋ 탭 추가" 단추 자리.
 * - 6개를 넘으면 "더 보기 ▾"로 접는다.
 */
export default function ConversationTabs({
  tabs,
  activeKey,
  trailing,
  renderMenu,
  maxVisible = MAX_VISIBLE_TABS,
  className,
}: {
  tabs: readonly ConversationTab[]
  activeKey: string
  trailing?: ReactNode
  renderMenu?: (tab: ConversationTab) => ReactNode
  maxVisible?: number
  className?: string
}) {
  const { visible, overflow } = splitVisibleTabs(tabs, activeKey, maxVisible)
  return (
    <nav aria-label="대화 탭" className={cn(SUB_NAV_BAR_CLASS, 'px-3', className)}>
      {/* 밑줄이 nav 테두리를 덮는 겹침(-mb-px)·스크롤바 숨김은 SUB_NAV_LIST_CLASS 가 ul 에 준다 */}
      <ul className={SUB_NAV_LIST_CLASS}>
        {visible.map(tab => {
          const active = tab.key === activeKey
          const Icon = tab.icon
          const menu = renderMenu?.(tab) ?? null
          return (
            <li key={tab.key} className="flex items-stretch">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={subNavItemClass(active, menu ? 'pr-1' : undefined)}
              >
                <Icon aria-hidden="true" className="size-4" />
                {tab.label}
              </Link>
              {menu ? <span className="flex items-center">{menu}</span> : null}
            </li>
          )
        })}
      </ul>
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="my-auto flex h-8 shrink-0 items-center gap-1 rounded-w-md px-2 pointer-coarse:min-h-11 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring focus-visible:ring-ring/50"
            aria-label={`더 보기, 탭 ${overflow.length}개`}
          >
            더 보기
            <ChevronDownIcon aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {overflow.map(tab => {
              const Icon = tab.icon
              return (
                <DropdownMenuItem key={tab.key} render={<Link href={tab.href} />}>
                  <Icon aria-hidden="true" className="size-4" />
                  {tab.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Teams 처럼 마지막 탭 바로 옆에 둔다 — 오른쪽 끝에 떨어져 있으면 탭을 추가할 수 있는 줄 모른다 */}
      {trailing ? <div className="flex shrink-0 items-center">{trailing}</div> : null}
    </nav>
  )
}
