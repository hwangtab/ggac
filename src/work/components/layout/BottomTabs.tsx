'use client'

import { useState } from 'react'
import Link from '@work/lib/nav/link'
import { usePathname } from '@work/lib/nav/navigation'
import { EllipsisIcon, LandmarkIcon, SearchIcon, SettingsIcon, type LucideIcon } from 'lucide-work'
import { Sheet, SheetContent, SheetTitle } from '@work/components/ui/sheet'
import { cn } from '@work/lib/utils'
import SectionBadgeMark from './SectionBadgeMark'
import {
  activeSection,
  adminSection,
  mainSections,
  sectionByKey,
  type SectionBadge,
  type SectionKey,
} from './nav-sections'

/** 하단 탭에 직접 나오는 섹션. ggac 이식 1b: 할 일은 2단계라 뺐다(nav-sections NAV_SECTIONS) */
const TAB_KEYS: readonly SectionKey[] = ['activity', 'chat', 'channels']

const TAB_CLASS =
  'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'

function MoreLink({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-11 items-center gap-3 rounded-w-md px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-muted font-medium'
      )}
    >
      <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      {label}
    </Link>
  )
}

/**
 * 모바일 하단 탭(<768px) — 활동 · 채팅 · 채널 · 할 일 · 더 보기. 설계 03 §2-4.
 * 탭은 섹션 루트로 간다(루트 화면이 곧 목록 전체 화면). "더 보기" 시트에는 자료실·위키·검색·설정·관리.
 * 대화·문서 화면에서는 셸이 이 컴포넌트를 그리지 않는다(← 뒤로가 대신한다).
 * iOS PWA 홈 바에 가리지 않도록 safe-area 아래 여백을 둔다.
 */
export default function BottomTabs({
  isGuest = false,
  isAdmin = false,
  badges = {},
}: {
  isGuest?: boolean
  isAdmin?: boolean
  badges?: Partial<Record<SectionKey, SectionBadge>>
}) {
  const pathname = usePathname() ?? '/'
  const current = activeSection(pathname)
  const [moreOpen, setMoreOpen] = useState(false)
  const close = () => setMoreOpen(false)

  const visible = mainSections({ isGuest })
  const tabs = TAB_KEYS.map(sectionByKey).filter(t => visible.some(v => v.key === t.key))
  const more = visible.filter(s => !TAB_KEYS.includes(s.key))
  const admin = adminSection({ isAdmin })
  // "더 보기" 안의 화면에 있으면 그 탭을 강조한다
  const moreActive =
    (current !== null && !TAB_KEYS.includes(current)) ||
    pathname.startsWith('/search') ||
    pathname.startsWith('/settings')

  return (
    <>
      <nav
        aria-label="앱 하단 메뉴"
        className="flex shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {tabs.map(t => {
          const Icon = t.icon
          const active = current === t.key
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(TAB_CLASS, active && 'font-semibold text-primary')}
            >
              <span className="relative">
                <Icon aria-hidden="true" className="size-5" />
                <SectionBadgeMark badge={badges[t.key]} />
              </span>
              <span>{t.label}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={cn(TAB_CLASS, moreActive && 'font-semibold text-primary')}
        >
          <EllipsisIcon aria-hidden="true" className="size-5" />
          <span>더 보기</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="gap-0 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          {/* 닫기 X(top-3 right-3, 터치 44px)가 놓이는 자리 — 제목 줄을 h-12 로 잡아 첫 항목과 겹치지 않게 */}
          <SheetTitle className="flex h-12 items-center pr-12 pl-3 text-sm font-semibold">
            더 보기
          </SheetTitle>
          <nav aria-label="더 보기">
            {more.map(s => (
              <MoreLink
                key={s.key}
                href={s.href}
                icon={s.icon}
                label={s.label}
                active={current === s.key}
                onNavigate={close}
              />
            ))}
            <MoreLink
              href="/search"
              icon={SearchIcon}
              label="검색"
              active={pathname.startsWith('/search')}
              onNavigate={close}
            />
            <MoreLink
              href="/settings"
              icon={SettingsIcon}
              label="설정"
              active={pathname.startsWith('/settings')}
              onNavigate={close}
            />
            {admin && (
              <MoreLink
                href={admin.href}
                icon={admin.icon}
                label={admin.label}
                active={current === 'admin'}
                onNavigate={close}
              />
            )}
            {/* ggac 이식: 업무툴 밖 이사회실(회의·서류함)로 돌아가는 길 */}
            <MoreLink
              href="/board-room"
              icon={LandmarkIcon}
              label="이사회실로"
              active={false}
              onNavigate={close}
            />
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}
