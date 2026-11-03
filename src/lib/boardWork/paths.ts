/**
 * 이사회 업무툴 경로 판정 — 순수 함수(로컬 import 금지: `node --test`가 이 파일을 직접 읽는다).
 *
 * 업무 화면은 `/board-room` 아래에 있고, 전역 내비·푸터·이사회실 좌측 메뉴 안에서 그린다
 * (docs/board-work/03-통합-재설계.md §2·§4-1). 이 판정이 정하는 것:
 * - 이사회실 메뉴 '업무' 묶음의 활성 항목(`boardWorkNavKey`)
 * - 업무 화면의 폭 정책(콘텐츠 칸 전폭)과 편집 화면의 메뉴 접기(`isBoardWorkEditPath`)
 */

/** `/board-room/<이 세그먼트>`로 시작하면 업무 화면이다. 원본(kosmart-work)의 앱 셸 경로 + 편집 화면. */
export const BOARD_WORK_SEGMENTS = [
  'chat',
  'c',
  'dm',
  'inbox',
  'tasks',
  'files',
  'search',
  'settings',
  'edit',
] as const

export const BOARD_WORK_HOME = '/board-room/chat'

/** 로케일 접두사(`/en`)를 뗀 경로. next-intl `usePathname`은 이미 떼서 주지만 `window.location`·미들웨어 경로는 아니다. */
function stripLocale(pathname: string): string {
  return pathname.replace(/^\/en(?=\/|$)/, '') || '/'
}

/** `/board-room/` 다음 첫 세그먼트(없으면 null) */
function workSegment(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const path = stripLocale(pathname.split(/[?#]/)[0])
  const m = /^\/board-room\/([^/]+)/.exec(path)
  return m ? m[1] : null
}

export function isBoardWorkPath(pathname: string | null | undefined): boolean {
  const seg = workSegment(pathname)
  return seg !== null && (BOARD_WORK_SEGMENTS as readonly string[]).includes(seg)
}

/** 앱 안 문서 편집 화면(`/board-room/edit/*`) — 이사회실 메뉴를 기본으로 접는다(03 §8 결정 2) */
export function isBoardWorkEditPath(pathname: string | null | undefined): boolean {
  return workSegment(pathname) === 'edit'
}

/** 이사회실 메뉴 '업무' 묶음의 항목 */
export type BoardWorkNavKey = 'chat' | 'inbox' | 'tasks' | 'files' | 'search' | 'settings'

/**
 * '업무' 묶음(03 §2-1). 원본 레일의 '채팅'·'채널'은 '대화' 하나로 합쳤다(§8 결정 1) — 목록 칸 안에서 채널·메시지로 나눈다.
 * 활동은 원본 받은 알림함(`/inbox`)이다.
 */
export const BOARD_WORK_NAV_ITEMS: readonly {
  key: BoardWorkNavKey
  href: string
  label: string
}[] = [
  { key: 'chat', href: '/board-room/chat', label: '대화' },
  { key: 'inbox', href: '/board-room/inbox', label: '활동' },
  { key: 'tasks', href: '/board-room/tasks', label: '할 일' },
  { key: 'files', href: '/board-room/files', label: '자료실' },
  { key: 'search', href: '/board-room/search', label: '검색' },
  { key: 'settings', href: '/board-room/settings', label: '업무 설정' },
]

/**
 * 지금 경로가 '업무' 묶음의 어느 항목인가. 채널(`c/*`)·DM(`dm/*`)·채널 찾아보기(`/c`)는 '대화'다.
 * 편집 화면(`edit/*`)과 업무 밖 경로는 null.
 */
export function boardWorkNavKey(pathname: string | null | undefined): BoardWorkNavKey | null {
  switch (workSegment(pathname)) {
    case 'chat':
    case 'c':
    case 'dm':
      return 'chat'
    case 'inbox':
      return 'inbox'
    case 'tasks':
      return 'tasks'
    case 'files':
      return 'files'
    case 'search':
      return 'search'
    case 'settings':
      return 'settings'
    default:
      return null
  }
}
