/**
 * 이사회 업무툴 경로 판정 — 순수 함수(로컬 import 금지: `node --test`가 이 파일을 직접 읽는다).
 *
 * 업무툴 화면은 `/board-room` 아래에 있지만 레이아웃이 다르다(docs/board-work/01-설계.md §2-1):
 * - 전역 내비게이션·푸터·포스터 테마(`data-poster`)를 쓰지 않는다 → `ConditionalLayout`
 * - 이사회실 좌측 메뉴를 쓰지 않는다 → `board-room/layout.tsx`
 * 두 곳이 같은 판정을 써야 한쪽만 빠지는 일이 없다.
 */

/** `/board-room/<이 세그먼트>`로 시작하면 업무툴이다. 원본(kosmart-work)의 앱 셸 경로 + 편집 화면. */
export const BOARD_WORK_SEGMENTS = [
  'chat',
  'c',
  'dm',
  'inbox',
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

export function isBoardWorkPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const path = stripLocale(pathname.split(/[?#]/)[0])
  const m = /^\/board-room\/([^/]+)/.exec(path)
  return m !== null && (BOARD_WORK_SEGMENTS as readonly string[]).includes(m[1])
}
