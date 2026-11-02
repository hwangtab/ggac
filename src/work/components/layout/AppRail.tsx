'use client'

import Link from '@work/lib/nav/link'
import { usePathname, useRouter } from '@work/lib/nav/navigation'
import { LandmarkIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'
import { APP_NAME } from '@work/lib/brand'
import SectionBadgeMark from './SectionBadgeMark'
import {
  activeSection,
  adminSection,
  mainSections,
  type NavSection,
  type SectionBadge,
  type SectionKey,
} from './nav-sections'
import { resolveSectionHref } from './use-last-location'
import type { ChannelListItem } from './channel-items'

export type AppRailProps = {
  isGuest?: boolean
  isAdmin?: boolean
  badges?: Partial<Record<SectionKey, SectionBadge>>
  /**
   * 내가 멤버인 채널·DM. 주면 채팅·채널 항목이 "마지막으로 본 대화"로 간다(목록에 없으면 섹션 루트).
   * 주지 않으면(관리 화면) 섹션 루트로만 간다.
   */
  items?: Pick<ChannelListItem, 'id' | 'slug' | 'kind'>[]
  className?: string
}

function RailItem({
  section,
  active,
  badge,
  items,
}: {
  section: NavSection
  active: boolean
  badge?: SectionBadge
  items?: AppRailProps['items']
}) {
  const router = useRouter()
  const Icon = section.icon
  return (
    <Link
      href={section.href}
      aria-current={active ? 'page' : undefined}
      onClick={e => {
        // 수정키·가운데 클릭은 브라우저 기본 동작(새 탭)에 맡긴다 — 이때는 섹션 루트로 열린다
        if (!items || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        const href = resolveSectionHref(section, items)
        if (href === section.href) return
        e.preventDefault()
        router.push(href)
      }}
      className={cn(
        'relative flex w-full flex-col items-center gap-1 rounded-w-md px-1 py-2 text-[11px] leading-tight text-sidebar-foreground/70 outline-none',
        'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active &&
          'bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary'
      )}
    >
      <span className="relative">
        <Icon aria-hidden="true" className="size-5" />
        <SectionBadgeMark badge={badge} />
      </span>
      <span>{section.label}</span>
    </Link>
  )
}

/**
 * 데스크톱 앱 레일(64px) — Teams 식 세로 아이콘 메뉴. 설계 03 §2-1.
 * 위: 로고 + 활동·채팅·채널·할 일·자료실·위키, 아래: 관리(owner/admin). 게스트는 자료실·위키가 없다.
 * 데이터는 props 로만 받는다(조회 없음).
 */
export default function AppRail({
  isGuest = false,
  isAdmin = false,
  badges = {},
  items,
  className,
}: AppRailProps) {
  const pathname = usePathname() ?? '/'
  const current = activeSection(pathname)
  const admin = adminSection({ isAdmin })
  return (
    <nav
      aria-label="앱"
      className={cn(
        'hidden w-[calc(var(--spacing-rail)+env(safe-area-inset-left))] shrink-0 flex-col pl-[env(safe-area-inset-left)] border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex',
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-center">
        <Link
          href="/"
          data-tooltip={APP_NAME}
          aria-label={`${APP_NAME} 홈`}
          className="flex size-8 items-center justify-center rounded-w-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span aria-hidden="true">이</span>
        </Link>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5">
        {mainSections({ isGuest }).map(s => (
          <li key={s.key}>
            <RailItem section={s} active={current === s.key} badge={badges[s.key]} items={items} />
          </li>
        ))}
      </ul>
      {admin && (
        <div className="shrink-0 px-1.5 pt-1 pb-2">
          <RailItem section={admin} active={current === 'admin'} />
        </div>
      )}
      {/* ggac 이식: 업무툴 밖 이사회실(회의·서류함·메일함)로 돌아가는 길 — 레일 맨 아래 */}
      <div className="shrink-0 px-1.5 pt-1 pb-2">
        <RailItem
          section={{
            key: 'admin',
            label: '이사회실',
            href: '/board-room',
            icon: LandmarkIcon,
            guest: true,
          }}
          active={false}
        />
      </div>
    </nav>
  )
}
