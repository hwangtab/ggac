/**
 * 이사회실 메뉴 '업무' 묶음의 배지 규칙 — 순수 함수(로컬 import 금지: `node --test`가 이 파일을 직접 읽는다).
 * docs/board-work/03-통합-재설계.md §2-1·§4-3·§8 결정 4.
 *
 * - 대화: 나를 부른 것(채널 멘션 + 뮤트 아닌 DM·그룹의 안 읽음)이 있으면 **앰버 바탕 숫자 배지**.
 *   그런 것은 없고 뮤트 아닌 채널에 안 읽은 글만 있으면 **작은 앰버 점**(항목 글자는 굵게).
 * - 활동: 읽지 않은 멘션 + 새 답글·반응 수(원본 레일 '활동' 배지와 같은 수) — 앰버 숫자 배지.
 * - 할 일: 내 열린 할 일 수 — 강조 없는 숫자.
 */

/** 대화 하나의 배지 재료(채널이든 DM·그룹이든) */
export type MenuConversation = {
  unread: number
  mentions?: number
  muted?: boolean
  /** DM·그룹 대화인가 — 안 읽은 글 자체가 나를 부른 것이다 */
  dm?: boolean
}

export type MenuBadgeInput = {
  conversations: readonly MenuConversation[]
  mentionCount: number
  activityCount: number
  openTaskCount: number
}

export type MenuBadge =
  | { kind: 'mention'; count: number; srText: string }
  | { kind: 'count'; count: number; srText: string }
  | { kind: 'dot'; count: 0; srText: string }

export type MenuBadgeKey = 'chat' | 'inbox' | 'tasks'

/**
 * 배지 모양 — 이사회실 메뉴(board-room/layout.tsx)와 업무 화면 목록 칸(채널·DM·활동)이 **같은 클래스**를 쓴다(§8-4).
 * 색은 호출처가 더한다: 메뉴는 업무 토큰 밖이라 `bg-[#fbd9a5] text-black`(+ `data-poster-keep` — 포스터가
 * `.text-black`을 흰 글자로 바꾸지 않게), 업무 화면은 `bg-mention-solid text-mention-solid-foreground`(같은 값).
 * - 숫자: 앰버 바탕·검은 글자의 작은 사각(2px). 포스터의 `.rounded-full → 2px` 규칙과 상관없이 2px로 둔다
 * - 점: 일반 안 읽음(글자는 굵게) — 6px 앰버 사각
 */
export const BADGE_COUNT_CLASS =
  'min-w-[1.25rem] shrink-0 rounded-[2px] px-1.5 text-center text-xs font-semibold leading-5 tabular-nums'
export const BADGE_DOT_CLASS = 'block size-1.5 shrink-0 rounded-[2px]'

/** 99 초과는 "99+" */
export function formatMenuBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

function nonNegative(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 대화 항목에서 "나를 부른 것"의 수 — DM은 안 읽음 전부(뮤트면 멘션만), 채널은 멘션만 */
function urgentOf(c: MenuConversation): number {
  const mentions = nonNegative(c.mentions)
  if (!c.dm) return mentions
  return c.muted ? mentions : Math.max(nonNegative(c.unread), mentions)
}

export function boardWorkMenuBadges(
  input: MenuBadgeInput
): Partial<Record<MenuBadgeKey, MenuBadge>> {
  const out: Partial<Record<MenuBadgeKey, MenuBadge>> = {}

  const urgent = input.conversations.reduce((sum, c) => sum + urgentOf(c), 0)
  if (urgent > 0) {
    out.chat = { kind: 'mention', count: urgent, srText: `나를 부른 새 메시지 ${urgent}개` }
  } else if (input.conversations.some(c => !c.muted && nonNegative(c.unread) > 0)) {
    out.chat = { kind: 'dot', count: 0, srText: '읽지 않은 메시지가 있음' }
  }

  const mentionCount = nonNegative(input.mentionCount)
  const activityCount = nonNegative(input.activityCount)
  const activity = mentionCount + activityCount
  if (activity > 0) {
    out.inbox = {
      kind: 'mention',
      count: activity,
      srText: activityCount > 0 ? `새 활동 ${activity}건` : `읽지 않은 멘션 ${mentionCount}건`,
    }
  }

  const tasks = nonNegative(input.openTaskCount)
  if (tasks > 0) out.tasks = { kind: 'count', count: tasks, srText: `열린 할 일 ${tasks}건` }

  return out
}

/** 대화별 종류·뮤트(서버가 준 목록) */
export type MenuConversationMeta = Record<string, { dm: boolean; muted: boolean }>

/**
 * 폴링 응답의 배지 스냅숏(채널 id → 안 읽음·멘션)을 대화 목록 재료로 바꾼다. 목록에 아직 없는 대화(처음 받은 DM·채널 초대)는
 * 뮤트 아닌 채널로 본다 — 멘션이면 숫자, 아니면 점으로 알린다(놓치는 쪽보다 낫다).
 */
export function conversationsFromSnapshot(
  channels: Record<string, { unread: number; mentions: number }>,
  meta: MenuConversationMeta | null | undefined
): MenuConversation[] {
  return Object.entries(channels).map(([id, c]) => {
    const m = meta?.[id]
    return { unread: c.unread, mentions: c.mentions, dm: m?.dm ?? false, muted: m?.muted ?? false }
  })
}
