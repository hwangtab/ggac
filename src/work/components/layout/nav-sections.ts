import {
  BellIcon,
  CheckSquareIcon,
  FolderIcon,
  HashIcon,
  MessageCircleIcon,
  type LucideIcon,
} from 'lucide-work'
import { APP_NAME } from '@work/lib/brand'
import type { ChannelListItem } from './channel-items'

/**
 * 앱 레일·하단 탭이 함께 쓰는 섹션 정의와 계산(순수 — 조회·DOM 없음). 설계 03 §2-2·§2-6.
 * 레일 순서는 활동 · 채팅 · 채널 · 할 일 · 결재 · 자료실 · 위키 (Alt+1~7 과 같다), 관리는 레일 하단.
 */
export type SectionKey =
  | 'activity'
  | 'chat'
  | 'channels'
  | 'tasks'
  | 'expenses'
  | 'files'
  | 'wiki'
  | 'admin'

export type NavSection = {
  key: SectionKey
  label: string
  /** 레일 클릭(마지막 위치가 없을 때)·모바일 탭이 가는 섹션 루트 */
  href: string
  icon: LucideIcon
  /** 게스트에게 보이는가 */
  guest: boolean
  /** owner/admin 에게만 보이는가 */
  admin?: boolean
}

/**
 * ggac 이식: 활동·채팅·채널·할 일(2b)·자료실(2a). 결재(지출결의)·위키·관리 화면은
 * 가져오지 않는다(설계 §1 — 구성원·채널 관리는 ggac 이사회 권한과 관리자 화면이 맡는다). SectionKey는 원본 그대로 둔다.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  { key: 'activity', label: '활동', href: '/inbox', icon: BellIcon, guest: true },
  { key: 'chat', label: '채팅', href: '/chat', icon: MessageCircleIcon, guest: true },
  { key: 'channels', label: '채널', href: '/c', icon: HashIcon, guest: true },
  { key: 'tasks', label: '할 일', href: '/tasks', icon: CheckSquareIcon, guest: true },
  { key: 'files', label: '자료실', href: '/files', icon: FolderIcon, guest: false },
]

export function sectionByKey(key: SectionKey): NavSection | undefined {
  return NAV_SECTIONS.find(s => s.key === key)
}

/** 레일 위쪽(주 메뉴) — 게스트는 자료실·위키를 뺀다. 관리는 포함하지 않는다. */
export function mainSections({ isGuest }: { isGuest: boolean }): NavSection[] {
  return NAV_SECTIONS.filter(s => !s.admin && (!isGuest || s.guest))
}

/** 레일 하단 관리 항목. owner/admin 이 아니면 null. */
export function adminSection({ isAdmin }: { isAdmin: boolean }): NavSection | null {
  // ggac 이식: 관리 화면은 가져오지 않는다(NAV_SECTIONS에 없다) — 늘 null
  return isAdmin ? (sectionByKey('admin') ?? null) : null
}

/** pathname 이 base 이거나 base 아래(`/c` 는 `/chat` 과 구분한다) */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** 현재 경로가 속한 섹션. `/search`·`/settings*`·`/` 등은 null(레일 모두 비활성). */
export function activeSection(pathname: string): SectionKey | null {
  if (under(pathname, '/inbox')) return 'activity'
  if (under(pathname, '/dm') || under(pathname, '/chat')) return 'chat'
  if (under(pathname, '/c')) return 'channels'
  if (under(pathname, '/tasks')) return 'tasks'
  if (under(pathname, '/files')) return 'files'
  // ggac 이식: 결재·위키·관리 섹션은 레일에 없다(NAV_SECTIONS)
  return null
}

/**
 * 모바일 대화·문서 화면이면 ← 뒤로 갈 곳, 섹션 루트 등은 null(하단 탭 표시).
 * - 대화의 하위 화면(`/c/<slug>/files`·`/c/<slug>/t/<id>`, `/dm/<id>/shared|files|t/<id>`)은 그 대화(게시물/채팅)로
 * - 대화 자체(/c/<slug>, /dm/<id>)는 섹션 루트(/c, /chat)로
 * - 위키 문서(/wiki/…)·파일 하위 경로(/files/…)·지출결의 하위(/expenses/…)는 각 섹션 루트로
 */
export function mobileBackHref(pathname: string): string | null {
  const channelSub = /^\/c\/([^/]+)\/(?:files|t\/[^/]+)(?:\/|$)/.exec(pathname)
  if (channelSub) return `/c/${channelSub[1]}`
  const dmSub = /^\/dm\/([^/]+)\/(?:shared|files|t\/[^/]+)(?:\/|$)/.exec(pathname)
  if (dmSub) return `/dm/${dmSub[1]}`
  if (pathname.startsWith('/c/')) return '/c'
  if (pathname.startsWith('/dm/')) return '/chat'
  if (pathname.startsWith('/wiki/')) return '/wiki'
  if (pathname.startsWith('/files/')) return '/files'
  if (pathname.startsWith('/expenses/')) return '/expenses'
  return null
}

export type SectionBadge = {
  /** mention: 빨강 숫자 · count: 기본색 숫자 · dot: 숫자 없는 점 */
  kind: 'mention' | 'count' | 'dot'
  count: number
  /** 스크린리더 문장(시각 배지는 aria-hidden) */
  srText: string
}

/** 99 초과는 "99+" */
export function formatBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

function dmUnread(dms: Pick<ChannelListItem, 'unread' | 'muted'>[]): number {
  return dms.reduce((sum, d) => sum + (d.muted ? 0 : d.unread), 0)
}

/**
 * 레일·하단 탭 배지(설계 §2-2). 없으면 해당 키가 없다.
 * - 활동: 읽지 않은 멘션 + 새 답글·반응 수 · 채팅: 뮤트 아닌 DM 안 읽음 합계
 * - 채널: 채널 멘션 합계(빨강), 멘션이 없고 안 읽음만 있으면 점 · 할 일: 미완료 수
 */
export function sectionBadges({
  channels,
  dms,
  mentionCount = 0,
  activityCount = 0,
  openTaskCount = 0,
  expenseCount = 0,
}: {
  channels: Pick<ChannelListItem, 'unread' | 'muted' | 'mentions'>[]
  dms: Pick<ChannelListItem, 'unread' | 'muted'>[]
  mentionCount?: number
  /** 새 스레드 답글·반응 수(멘션과 겹치지 않는다 — 0019) */
  activityCount?: number
  openTaskCount?: number
  /** 결재 대기·송금 대기·내 안 본 건의 합(0045 my_expense_counts) */
  expenseCount?: number
}): Partial<Record<SectionKey, SectionBadge>> {
  const out: Partial<Record<SectionKey, SectionBadge>> = {}
  const activityTotal = mentionCount + activityCount
  if (activityTotal > 0) {
    out.activity = {
      kind: 'mention',
      count: activityTotal,
      // 멘션만 있으면 기존 문장, 답글·반응이 섞이면 '새 활동'
      srText: activityCount > 0 ? `새 활동 ${activityTotal}건` : `읽지 않은 멘션 ${mentionCount}건`,
    }
  }
  const dmCount = dmUnread(dms)
  if (dmCount > 0) {
    out.chat = { kind: 'count', count: dmCount, srText: `읽지 않은 메시지 ${dmCount}개` }
  }
  const channelMentions = channels.reduce((sum, c) => sum + (c.mentions ?? 0), 0)
  if (channelMentions > 0) {
    out.channels = {
      kind: 'mention',
      count: channelMentions,
      srText: `멘션 ${channelMentions}개`,
    }
  } else if (channels.some(c => !c.muted && c.unread > 0)) {
    out.channels = { kind: 'dot', count: 0, srText: '읽지 않은 메시지가 있음' }
  }
  if (openTaskCount > 0) {
    out.tasks = { kind: 'count', count: openTaskCount, srText: `미완료 ${openTaskCount}건` }
  }
  if (expenseCount > 0) {
    out.expenses = { kind: 'count', count: expenseCount, srText: `처리할 결재 ${expenseCount}건` }
  }
  return out
}

/** 탭 제목·앱 배지의 N: 안 읽은 멘션 + 새 답글·반응 + 뮤트 아닌 DM 안 읽음(일반 채널 안 읽음은 제외, 설계 §2-6) */
export function unreadTitleCount({
  dms,
  mentionCount = 0,
  activityCount = 0,
}: {
  dms: Pick<ChannelListItem, 'unread' | 'muted'>[]
  mentionCount?: number
  activityCount?: number
}): number {
  return mentionCount + activityCount + dmUnread(dms)
}

/** 안 읽음이 있으면 `(N) ` 접두사를 붙인 제목 */
export function titleWithCount(base: string, count: number): string {
  return count > 0 ? `(${formatBadgeCount(count)}) ${base}` : base
}

/** 기본 탭 제목: `(N) 한국스마트협동조합 업무 시스템` */
export function documentTitle(count: number): string {
  return titleWithCount(APP_NAME, count)
}

/** 제목에서 앞의 `(N) ` 접두사를 뗀다 */
export function stripCountPrefix(title: string): string {
  return title.replace(/^\((?:\d+\+?)\) /, '')
}

/** Alt+Digit1~7 → 보이는 주 메뉴의 N번째 섹션. 해당 없으면 null. */
export function sectionForShortcut(
  code: string,
  visible: readonly NavSection[]
): NavSection | null {
  const m = /^Digit([1-7])$/.exec(code)
  if (!m) return null
  return visible[Number(m[1]) - 1] ?? null
}
