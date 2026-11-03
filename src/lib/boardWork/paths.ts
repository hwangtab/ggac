/**
 * 이사회 업무툴 경로 판정 — 순수 함수(로컬 import 금지: `node --test`가 이 파일을 직접 읽는다).
 *
 * 업무 화면은 `/board-room` 아래에 있고, 전역 내비·푸터·이사회실 좌측 메뉴 안에서 그린다
 * (docs/board-work/03-통합-재설계.md §2·§4-1). 이 판정이 정하는 것:
 * - 이사·감사·관리자 메뉴의 묶음과 활성 항목(`BOARD_MENU_GROUPS`·`boardMenuKey`)
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

/**
 * 이사·감사·관리자 메뉴의 항목 키(03 §10 R4). 업무 화면 항목(대화·활동·할 일·자료실·설정)과 기존 이사회실 화면이
 * 한 메뉴 안에서 묶음(이사회·소통·업무)으로 섞인다. 조합원 메뉴는 이 모델을 쓰지 않는다(레이아웃의 `MEMBER_NAV_ITEMS`).
 */
export type BoardMenuKey =
  | 'dashboard'
  | 'meetings'
  | 'schedule'
  | 'assembly'
  | 'charter'
  | 'chat'
  | 'inbox'
  | 'mailbox'
  | 'tasks'
  | 'files'
  | 'timebank'
  | 'settings'

export type BoardMenuItem = { key: BoardMenuKey; href: string; label: string }

/** 묶음. `label`이 null이면 제목 없는 첫 줄(대시보드) */
export type BoardMenuGroup = { key: string; label: string | null; items: readonly BoardMenuItem[] }

/**
 * 이사·감사·관리자 메뉴(사용자 피드백 2026-11-03: "업무 묶음 제목만 글씨가 작고 메뉴 체계가 잘못돼 있다").
 * - 이사회: 회의·일정 투표·정기총회·정관 / 소통: 대화·활동·메일함 / 업무: 할 일·자료실·타임뱅크 보고
 * - '검색'은 메뉴에서 뺐다 — 목록 칸 찾기 입력(Enter)·⌘K·자료실 안에서 간다. `/board-room/search`는 그대로 열린다.
 * - '서류함'도 뺐다 — 이사회 서류는 자료실의 '이사회 서류' 묶음에서 본다(`/board-room/documents`는 그대로 열린다).
 * 원본 레일의 '채팅'·'채널'은 '대화' 하나다(§8 결정 1). 활동은 원본 받은 알림함(`/inbox`)이다.
 */
export const BOARD_MENU_GROUPS: readonly BoardMenuGroup[] = [
  {
    key: 'home',
    label: null,
    items: [{ key: 'dashboard', href: '/board-room', label: '대시보드' }],
  },
  {
    key: 'board',
    label: '이사회',
    items: [
      { key: 'meetings', href: '/board-room/meetings', label: '이사회 회의' },
      { key: 'schedule', href: '/board-room/schedule', label: '일정 투표' },
      { key: 'assembly', href: '/board-room/assembly', label: '정기총회' },
      { key: 'charter', href: '/board-room/charter', label: '정관' },
    ],
  },
  {
    key: 'comms',
    label: '소통',
    items: [
      { key: 'chat', href: '/board-room/chat', label: '대화' },
      { key: 'inbox', href: '/board-room/inbox', label: '활동' },
      { key: 'mailbox', href: '/board-room/mailbox', label: '메일함' },
    ],
  },
  {
    key: 'work',
    label: '업무',
    items: [
      { key: 'tasks', href: '/board-room/tasks', label: '할 일' },
      { key: 'files', href: '/board-room/files', label: '자료실' },
      { key: 'timebank', href: '/board-room/timebank', label: '타임뱅크 보고' },
    ],
  },
]

/** 헤어라인 아래 마지막 항목 — 알림·직함·상태 메시지(예전 '업무 설정') */
export const BOARD_MENU_SETTINGS: BoardMenuItem = {
  key: 'settings',
  href: '/board-room/settings',
  label: '설정',
}

/**
 * 지금 경로가 이사 메뉴의 어느 항목인가. 채널(`c/*`)·DM(`dm/*`)·채널 찾아보기(`/c`)는 '대화',
 * 서류함(`documents/*`)은 '자료실'이다(이사회 서류가 자료실 안에 있다). 검색·편집 화면과 모르는 경로는 null — 아무것도
 * 칠하지 않는다.
 */
export function boardMenuKey(pathname: string | null | undefined): BoardMenuKey | null {
  if (!pathname) return null
  const path = stripLocale(pathname.split(/[?#]/)[0]).replace(/\/+$/, '') || '/'
  if (path === '/board-room') return 'dashboard'
  switch (workSegment(path)) {
    case 'meetings':
      return 'meetings'
    case 'schedule':
      return 'schedule'
    case 'assembly':
      return 'assembly'
    case 'charter':
      return 'charter'
    case 'chat':
    case 'c':
    case 'dm':
      return 'chat'
    case 'inbox':
      return 'inbox'
    case 'mailbox':
      return 'mailbox'
    case 'tasks':
      return 'tasks'
    case 'files':
    case 'documents':
      return 'files'
    case 'timebank':
      return 'timebank'
    case 'settings':
      return 'settings'
    default:
      return null
  }
}
