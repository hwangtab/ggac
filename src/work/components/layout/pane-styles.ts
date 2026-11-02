/** 모바일 본문(배경 토큰)에서 정렬 메뉴 트리거 색 — PANE_ACTION_CLASS 의 사이드바 색을 덮어쓴다 */
export const MOBILE_SORT_CLASS =
  'h-9 min-w-9 pointer-coarse:h-11 pointer-coarse:min-w-11 justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring'

/** 목록 패널 머리글 오른쪽의 작은 링크(+ 새 채팅 · + 채널 추가 · + 새 할 일) 공통 스타일 */
export const PANE_ACTION_CLASS =
  'flex h-7 pointer-coarse:h-11 items-center gap-0.5 rounded-w-md px-2 text-xs text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring'

/** 사이드바 목록 행 공통(docs/13 §2·§6): h-8(터치 기기 h-11) · px-2 · rounded-md · text-sm. 활성은 ROW_ACTIVE_CLASS 를 더한다 */
export const ROW_CLASS =
  'flex h-8 pointer-coarse:h-11 items-center gap-2 rounded-w-md px-2 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring'
/** 활성 = 배경색 + 굵기 + 왼쪽 2px 막대(색 외의 단서, docs/13 §2) */
export const ROW_ACTIVE_CLASS =
  'relative bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary'

/** 파일 트리 행(펼침 버튼 + 링크를 품는 래퍼) — ROW_CLASS 와 같은 높이·hover, 안쪽 여백은 자식이 맡는다 */
export const TREE_ROW_CLASS =
  'flex h-8 pointer-coarse:h-11 items-center rounded-w-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'

/** 숫자 배지(docs/13 §4) */
export const COUNT_BADGE_CLASS =
  'min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold'
