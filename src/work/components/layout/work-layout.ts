/**
 * 업무 화면 셸(WorkShell)의 배치 규칙 — 순수 함수(로컬 import 금지: `node --test`가 이 파일을 직접 읽는다).
 * docs/board-work/03-통합-재설계.md §2-2·§3. 경로는 원본 모양(`/inbox`·`/c/<slug>` — `@work/lib/nav/navigation`의
 * `usePathname`)이다.
 *
 * ggac에서 더한 파일이다(원본 AppShell의 레일·하단 탭 규칙 `nav-sections.ts`를 대신한다).
 */

/** 이사회실 메뉴 '업무' 묶음과 같은 갈래. 원본의 '채팅'·'채널'은 '대화'(chat) 하나다 */
export type WorkSection = 'chat' | 'activity' | 'tasks' | 'files' | 'search' | 'settings'

/** pathname 이 base 이거나 base 아래(`/c` 는 `/chat` 과 구분한다) */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

export function workSection(pathname: string): WorkSection | null {
  if (under(pathname, '/chat') || under(pathname, '/c') || under(pathname, '/dm')) return 'chat'
  if (under(pathname, '/inbox')) return 'activity'
  if (under(pathname, '/tasks')) return 'tasks'
  if (under(pathname, '/files')) return 'files'
  if (under(pathname, '/search')) return 'search'
  if (under(pathname, '/settings')) return 'settings'
  return null
}

/** 목록 칸이 있는 갈래 — 업무 설정은 1단이다 */
export function hasWorkListPane(section: WorkSection | null): boolean {
  return section !== null && section !== 'settings'
}

/**
 * 좁은 화면(lg 미만)에서 목록 칸이 화면을 차지하는가 — 메일함과 같은 목록 → 상세 전환. 대화 첫 화면(`/chat`)이 곧 목록이다.
 * 그 밖의 화면(대화·활동·할 일·자료실·검색)은 본문이 보이고 목록 칸은 접힌다(각 화면이 좁은 화면용 필터를 따로 그린다).
 */
export function mobileShowsList(pathname: string, opts: { newChat?: boolean } = {}): boolean {
  return pathname === '/chat' && !opts.newChat
}

export type MobileBackLink = { href: string; label: '목록' | '대화' }

/**
 * 좁은 화면 본문 머리의 `← 목록` / `← 대화`. 없으면 null.
 * - 대화의 하위 화면(채널 파일·대화 탭·DM 공유 항목)은 그 대화로(`← 대화`)
 * - 대화 자체·채널 찾아보기·새 채팅은 대화 목록(`/chat`)으로, 파일 상세는 자료실로(`← 목록`)
 */
export function mobileBackLink(
  pathname: string,
  opts: { newChat?: boolean } = {}
): MobileBackLink | null {
  const channelSub = /^\/c\/([^/]+)\/(?:files|t\/[^/]+)(?:\/|$)/.exec(pathname)
  if (channelSub) return { href: `/c/${channelSub[1]}`, label: '대화' }
  const dmSub = /^\/dm\/([^/]+)\/(?:shared|files|t\/[^/]+)(?:\/|$)/.exec(pathname)
  if (dmSub) return { href: `/dm/${dmSub[1]}`, label: '대화' }
  if (under(pathname, '/c') || pathname.startsWith('/dm/')) return { href: '/chat', label: '목록' }
  if (pathname === '/chat' && opts.newChat) return { href: '/chat', label: '목록' }
  if (pathname.startsWith('/files/')) return { href: '/files', label: '목록' }
  return null
}

/**
 * 업무 화면 높이 — 메일함과 같은 방식(03 §3): 화면 높이 − 위쪽 크롬(전역 내비 + 이사회실 `py` 여백 + 좁은 화면의 가로 탭 줄),
 * 칸마다 따로 스크롤한다. 푸터 때문에 페이지 스크롤은 남는다(메일함 주석과 같다). 값은 실측(390·1280·1536)으로 정했다.
 */
export const WORK_PANE_HEIGHT_CLASS =
  'h-[calc(100dvh-11rem)] md:h-[calc(100dvh-13rem)] lg:h-[calc(100dvh-9rem)] min-h-[480px]'
