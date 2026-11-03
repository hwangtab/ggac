'use client'

import { useState } from 'react'
import Link from '@work/lib/nav/link'
import { ArrowLeftIcon, PanelLeftIcon, SearchIcon } from 'lucide-work'
import { Button, buttonVariants } from '@work/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import ThemeToggle from '@work/components/theme/ThemeToggle'
import StatusDialog from '@work/components/notifications/StatusDialog'
import { statusLine, type ActiveStatus } from '@work/lib/notifications/status'
import { APP_NAME_SHORT } from '@work/lib/brand'
import { cn } from '@work/lib/utils'
import { LIST_PANE_ID } from './ListPane'

/**
 * 상단 바 — 가운데 검색 단추(누르면 QuickSwitcher, ⌘K 와 같다) · 테마 토글 · 프로필 메뉴.
 * 데스크톱: 왼쪽에 목록 패널 접기/펼치기(목록이 있는 섹션에서만).
 * 모바일: 왼쪽에 ← 뒤로(대화·문서 화면) 또는 섹션 제목, 검색은 돋보기 아이콘만.
 * 채널 머리글(#이름·주제·멤버 수)은 채널 페이지가 자기 영역에 그린다.
 */
export default function TopBar({
  displayName,
  title,
  status,
  onOpenSwitcher,
  onSignOut,
  backHref,
  mobileTitle,
  listToggle,
}: {
  displayName: string
  /** 프로필 메뉴의 직함 */
  title?: string | null
  /** 내 상태 메시지(0027, 만료는 서버가 거른 값) */
  status?: ActiveStatus | null
  onOpenSwitcher: () => void
  onSignOut: () => void
  /** 모바일 대화·문서 화면에서 ← 뒤로 갈 섹션 루트 */
  backHref?: string | null
  /** 모바일 머리글 제목(섹션 이름). 없으면 짧은 앱 이름 */
  mobileTitle?: string
  /** 데스크톱 목록 패널 접기 단추(목록이 있는 섹션에서만 넘긴다) */
  listToggle?: { collapsed: boolean; onToggle: () => void }
}) {
  const [statusOpen, setStatusOpen] = useState(false)
  // viewportFit: cover — 가로 모드 노치 쪽 오른쪽 안전 영역을 비운다(왼쪽은 AppRail 이 맡는다)
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b pr-[max(0.5rem,env(safe-area-inset-right))] pl-2 md:pr-[max(1rem,env(safe-area-inset-right))] md:pl-4">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
        {backHref && (
          <Link
            href={backHref}
            aria-label="뒤로"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'md:hidden')}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Link>
        )}
        <div id="topbar-title" className="min-w-0 truncate text-base font-semibold md:hidden">
          {mobileTitle ?? APP_NAME_SHORT}
        </div>
        {listToggle && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={listToggle.onToggle}
            aria-expanded={!listToggle.collapsed}
            aria-controls={listToggle.collapsed ? undefined : LIST_PANE_ID}
            aria-label={listToggle.collapsed ? '목록 펼치기' : '목록 접기'}
          >
            <PanelLeftIcon aria-hidden="true" />
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenSwitcher}
        aria-label="채널·사람·메시지 검색"
        className={cn(
          'flex h-8 shrink-0 items-center justify-center rounded-w-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'size-8 pointer-coarse:size-11 hover:bg-muted md:h-8 md:w-full md:max-w-[560px] md:flex-[0_1_560px] md:justify-start md:gap-2 md:border md:bg-muted md:px-3 md:text-sm'
        )}
      >
        <SearchIcon aria-hidden="true" className="size-4" />
        <span className="hidden flex-1 text-left md:inline">채널·사람·메시지 검색</span>
        <kbd className="hidden rounded-w-md border px-1.5 font-sans text-xs md:inline">⌘K</kbd>
      </button>

      <div className="flex shrink-0 basis-0 items-center justify-end gap-1 md:flex-1">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="내 계정 메뉴"
              />
            }
          >
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            >
              {displayName.trim().slice(0, 1) || '?'}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <span className="block font-medium text-foreground">{displayName}</span>
                {title && <span className="block text-xs font-normal">{title}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setStatusOpen(true)}>
              {status ? `상태: ${statusLine(status)}` : '상태 메시지 설정'}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}>설정</DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings/notifications" />}>
              알림 설정
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* ggac 이식: 업무툴 밖 이사회실·홈페이지로 */}
            <DropdownMenuItem render={<Link href="/board-room" />}>이사회실로</DropdownMenuItem>
            <DropdownMenuItem onClick={onSignOut}>로그아웃</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <StatusDialog
          key={statusOpen ? 'open' : 'closed'}
          open={statusOpen}
          onOpenChange={setStatusOpen}
          current={status ?? null}
        />
      </div>
    </header>
  )
}
