'use client'

import { useEffect, useState } from 'react'
import { Link, usePathname } from '@/i18n/navigation'
import { fetchSessionProfile, canAccessBoardRoom } from '@/utils/sessionProfile'

// 메뉴는 역할에 따라 **순서와 이름이 다르다.** 이사에게 이 공간은 회의를
// 굴리는 곳이라 대시보드가 먼저지만, 조합원에게는 조합을 알아보는 곳이라
// 정관이 먼저다. 같은 화면이라도 '서류함'(올리는 곳)과 '조합 서류'(읽는 곳)는
// 하는 일이 달라 이름을 나눈다.
//
// 서류함·정기총회는 페이지를 열되 자료마다 `visibility`로 다시 갈린다 —
// 조합원은 'members' 자료만 본다. 미들웨어가 나머지 경로를 실제로 막는다.
const BOARD_NAV_ITEMS = [
  { href: '/board-room', label: '대시보드', exact: true },
  { href: '/board-room/meetings', label: '이사회 회의' },
  { href: '/board-room/schedule', label: '일정 투표' },
  { href: '/board-room/documents', label: '서류함' },
  { href: '/board-room/assembly', label: '정기총회' },
  { href: '/board-room/mailbox', label: '메일함' },
] as const

// 조합원에게는 대시보드를 두지 않는다 — 그 화면은 이사회 회의 목록이고,
// 회의 목록은 아래 '이사회 회의록'이 이미 담당한다. `/board-room`으로 들어온
// 조합원은 대시보드가 조합 서류로 보낸다.
const MEMBER_NAV_ITEMS = [
  { href: '/board-room/documents', label: '조합 서류' },
  { href: '/board-room/assembly', label: '정기총회' },
  { href: '/board-room/meetings', label: '이사회 회의록' },
] as const

export default function BoardRoomLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // 판정이 끝나기 전에는 이사회 전용 메뉴를 감춘 상태로 둔다. 반대로 두면
  // 조합원 화면에서 메뉴가 잠깐 보였다 사라진다.
  const [isBoardMember, setIsBoardMember] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await fetchSessionProfile()
        if (mounted) setIsBoardMember(canAccessBoardRoom(session.profile))
      } catch {
        if (mounted) setIsBoardMember(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const visibleNavItems: readonly { href: string; label: string; exact?: boolean }[] = isBoardMember
    ? BOARD_NAV_ITEMS
    : MEMBER_NAV_ITEMS

  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <div className="pt-16 md:pt-20 min-h-screen bg-gray-50/40">
      <div className="container mx-auto px-4">
        <div className="flex flex-col lg:flex-row lg:gap-8 py-6 md:py-8">
          {/* 사이드 메뉴 (데스크톱: 좌측 세로 / 모바일: 상단 가로 스크롤) */}
          <aside className="mb-5 lg:mb-0 lg:w-52 lg:flex-shrink-0">
            <nav
              aria-label={isBoardMember ? '이사회 메뉴' : '조합 자료 메뉴'}
              className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0 lg:sticky lg:top-24"
            >
              {visibleNavItems.map(item => {
                const active = isActive(item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </aside>

          {/* 콘텐츠 */}
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  )
}
