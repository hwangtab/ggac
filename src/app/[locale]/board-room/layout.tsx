'use client'

import { useEffect, useState } from 'react'
import { FiChevronsLeft, FiChevronsRight } from 'react-icons/fi'
import { Link, usePathname } from '@/i18n/navigation'
import { fetchSessionProfile, canAccessBoardRoom } from '@/utils/sessionProfile'
import {
  BOARD_WORK_NAV_ITEMS,
  boardWorkNavKey,
  isBoardWorkEditPath,
  isBoardWorkPath,
} from '@/lib/boardWork/paths'
import {
  BADGE_COUNT_CLASS,
  BADGE_DOT_CLASS,
  formatMenuBadgeCount,
  type MenuBadge,
} from '@/lib/boardWork/menuBadges'
import { BoardWorkBadgesProvider, useBoardWorkBadges } from '@/components/boardWork/BoardWorkBadges'

// 메뉴는 역할에 따라 **순서와 이름이 다르다.** 이사에게 이 공간은 회의를
// 굴리는 곳이라 대시보드가 먼저지만, 조합원에게는 조합을 알아보는 곳이라
// 정관이 먼저다. 같은 화면이라도 '서류함'(올리는 곳)과 '조합 서류'(읽는 곳)는
// 하는 일이 달라 이름을 나눈다.
//
// 서류함·정기총회는 페이지를 열되 자료마다 `visibility`로 다시 갈린다 —
// 조합원은 'members' 자료만 본다. 미들웨어가 나머지 경로를 실제로 막는다.
const BOARD_NAV_ITEMS = [
  { href: '/board-room', label: '대시보드', exact: true },
  { href: '/board-room/charter', label: '정관' },
  { href: '/board-room/meetings', label: '이사회 회의' },
  { href: '/board-room/schedule', label: '일정 투표' },
  { href: '/board-room/documents', label: '서류함' },
  { href: '/board-room/assembly', label: '정기총회' },
  { href: '/board-room/mailbox', label: '메일함' },
  { href: '/board-room/timebank', label: '타임뱅크 보고' },
] as const

// 조합원에게는 대시보드를 두지 않는다 — 그 화면은 이사회 회의 목록이고,
// 회의 목록은 아래 '이사회 회의록'이 이미 담당한다. `/board-room`으로 들어온
// 조합원은 대시보드가 조합 서류로 보낸다.
const MEMBER_NAV_ITEMS = [
  { href: '/board-room/charter', label: '정관' },
  { href: '/board-room/documents', label: '조합 서류' },
  { href: '/board-room/assembly', label: '정기총회' },
  { href: '/board-room/meetings', label: '이사회 회의록' },
] as const

export default function BoardRoomLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // 세 값이다: `null`은 **아직 판정하지 못했다**(로딩 또는 세션 조회 실패),
  // `true`/`false`는 판정 결과다. 둘을 구분하는 이유: `fetchSessionProfile`은
  // 실패해도 reject하지 않고 빈 세션을 준다 — 그것을 false로 접으면 순단 한
  // 번에 이사 메뉴가 조합원 메뉴로 바뀌어 일정 투표·메일함 링크가 사라진다.
  // 판정 전에는 메뉴를 그리지 않는다. 먼저 한쪽을 그렸다가 바꾸면 이사는 매
  // 로드마다 항목 수·라벨·순서가 통째로 흔들리는 깜빡임을 본다.
  const [isBoardMember, setIsBoardMember] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await fetchSessionProfile()
        // 인증이 확인된 세션만 판정으로 받는다. 그 밖에는 `null`로 남겨
        // 메뉴를 그리지 않는다 — 틀린 메뉴를 보여주느니 비워 두는 편이 낫다.
        if (mounted && session.authenticated) {
          setIsBoardMember(canAccessBoardRoom(session.profile))
        }
      } catch {
        // 판정 실패. `null`을 유지한다.
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const visibleNavItems: readonly { href: string; label: string; exact?: boolean }[] =
    isBoardMember === null ? [] : isBoardMember ? BOARD_NAV_ITEMS : MEMBER_NAV_ITEMS

  // 업무 화면(docs/board-work/03-통합-재설계.md §3)은 이 레이아웃 안에서 그린다 — 전역 내비·이 메뉴·푸터가 그대로다.
  // 업무 화면은 콘텐츠 칸 전폭을 쓴다(페이지가 max-w를 두지 않는다). 편집 화면은 폭이 가장 필요해 메뉴를 기본으로 접는다.
  const inWork = isBoardWorkPath(pathname)
  const inEdit = isBoardWorkEditPath(pathname)
  const [editMenuOpen, setEditMenuOpen] = useState(false)
  // 편집 화면에 새로 들어올 때마다 접힌 상태로 시작한다
  useEffect(() => {
    if (inEdit) setEditMenuOpen(false)
  }, [inEdit])
  const menuCollapsed = inEdit && !editMenuOpen

  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <BoardWorkBadgesProvider enabled={isBoardMember === true}>
      <div
        className="pt-16 md:pt-20 min-h-screen bg-gray-50/40"
        data-board-work={inWork ? '' : undefined}
      >
        <div className="container mx-auto px-4">
          <div
            className={`flex flex-col lg:flex-row py-6 md:py-8 ${
              menuCollapsed ? 'lg:gap-3' : 'lg:gap-8'
            }`}
          >
            {/* 사이드 메뉴 (데스크톱: 좌측 세로 / 모바일: 상단 가로 스크롤) */}
            <aside
              className={`lg:flex-shrink-0 ${
                menuCollapsed ? 'mb-3 lg:mb-0' : 'mb-5 lg:mb-0 lg:w-52'
              }`}
            >
              {inEdit && (
                <button
                  type="button"
                  onClick={() => setEditMenuOpen(v => !v)}
                  aria-expanded={!menuCollapsed}
                  aria-controls="board-room-menu"
                  title={menuCollapsed ? '메뉴 펼치기' : '넓게 보기'}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:sticky lg:top-24 ${
                    menuCollapsed ? 'px-3 py-2 lg:px-2 lg:py-2.5' : 'mb-2 w-full px-4 py-2'
                  }`}
                >
                  {menuCollapsed ? (
                    <FiChevronsRight aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <FiChevronsLeft aria-hidden="true" className="h-4 w-4" />
                  )}
                  <span className={menuCollapsed ? 'lg:sr-only' : undefined}>
                    {menuCollapsed ? '메뉴 펼치기' : '넓게 보기'}
                  </span>
                </button>
              )}
              <nav
                id="board-room-menu"
                aria-label={
                  isBoardMember === null
                    ? '메뉴 불러오는 중'
                    : isBoardMember
                      ? '이사회 메뉴'
                      : '조합 자료 메뉴'
                }
                aria-busy={isBoardMember === null}
                hidden={menuCollapsed}
                // `hidden` 속성만으로는 `flex` 유틸리티가 이겨 보인다 — 클래스로도 숨긴다
                className={`${menuCollapsed ? 'hidden' : 'flex'} gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0 ${
                  inEdit ? '' : 'lg:sticky lg:top-24'
                }`}
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
                {isBoardMember === true && <BoardWorkNavGroup pathname={pathname} />}
              </nav>
            </aside>

            {/* 콘텐츠 */}
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </div>
    </BoardWorkBadgesProvider>
  )
}

/**
 * 메뉴의 '업무' 묶음(03 §2-1) — 이사·감사·관리자에게만. 모바일에서는 같은 가로 탭 줄에 이어 붙는다(`contents`).
 * 배지는 업무 화면 밖에서도 갱신된다(BoardWorkBadgesProvider).
 */
function BoardWorkNavGroup({ pathname }: { pathname: string }) {
  const activeKey = boardWorkNavKey(pathname)
  const badges = useBoardWorkBadges()?.badges ?? {}
  return (
    <div
      role="group"
      aria-labelledby="board-work-nav-label"
      className="contents lg:mt-4 lg:flex lg:flex-col lg:gap-1"
    >
      <span
        id="board-work-nav-label"
        className="self-center whitespace-nowrap border-l border-gray-200 pl-3 pr-1 text-xs font-semibold uppercase tracking-wider text-gray-400 lg:self-auto lg:border-l-0 lg:px-4 lg:pb-1"
      >
        업무
      </span>
      {BOARD_WORK_NAV_ITEMS.map(item => {
        const active = activeKey === item.key
        const badge =
          item.key === 'chat' || item.key === 'inbox' || item.key === 'tasks'
            ? badges[item.key]
            : undefined
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            data-board-work-nav={item.key}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm transition-colors ${
              badge ? 'font-bold' : 'font-medium'
            } ${
              active
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <span>{item.label}</span>
            {badge && <MenuBadgeMark badge={badge} />}
          </Link>
        )
      })}
    </div>
  )
}

/** 배지 모양(03 §8 결정 4): 멘션 = 앰버 바탕·검은 글자 숫자, 일반 안 읽음 = 작은 앰버 점, 할 일 = 강조 없는 숫자 */
function MenuBadgeMark({ badge }: { badge: MenuBadge }) {
  if (badge.kind === 'dot') {
    return (
      <span data-badge="dot" className="ml-auto flex items-center">
        <span aria-hidden="true" className={`${BADGE_DOT_CLASS} bg-[#fbd9a5]`} />
        <span className="sr-only">{badge.srText}</span>
      </span>
    )
  }
  const mention = badge.kind === 'mention'
  return (
    <span
      data-badge={badge.kind}
      // 앰버 위 검은 글자 — 포스터가 `.text-black`을 흰 글자로 바꾸지 않게 예외로 둔다
      data-poster-keep={mention ? '' : undefined}
      className={`ml-auto ${BADGE_COUNT_CLASS} ${
        mention ? 'bg-[#fbd9a5] text-black' : 'font-normal text-gray-500'
      }`}
    >
      <span aria-hidden="true">{formatMenuBadgeCount(badge.count)}</span>
      <span className="sr-only">{badge.srText}</span>
    </span>
  )
}
