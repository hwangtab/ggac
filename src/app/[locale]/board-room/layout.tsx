'use client'

import { useEffect, useState } from 'react'
import { Link, usePathname } from '@/i18n/navigation'
import { fetchSessionProfile, canAccessBoardRoom } from '@/utils/sessionProfile'

// `boardOnly`인 메뉴는 이사·감사·관리자에게만 보인다. 조합원에게 열린 것은
// 대시보드와 회의(안건·회의록)뿐이고, 미들웨어가 나머지 경로를 실제로 막는다.
const navItems = [
  { href: '/board-room', label: '대시보드', exact: true, boardOnly: false },
  { href: '/board-room/meetings', label: '이사회 회의', boardOnly: false },
  { href: '/board-room/schedule', label: '일정 투표', boardOnly: true },
  { href: '/board-room/documents', label: '서류함', boardOnly: true },
  { href: '/board-room/assembly', label: '정기총회', boardOnly: true },
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

  const visibleNavItems = navItems.filter(item => !item.boardOnly || isBoardMember)

  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <div className="pt-16 md:pt-20 min-h-screen bg-gray-50/40">
      <div className="container mx-auto px-4">
        <div className="flex flex-col lg:flex-row lg:gap-8 py-6 md:py-8">
          {/* 사이드 메뉴 (데스크톱: 좌측 세로 / 모바일: 상단 가로 스크롤) */}
          <aside className="mb-5 lg:mb-0 lg:w-52 lg:flex-shrink-0">
            <nav
              aria-label="이사회 메뉴"
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
