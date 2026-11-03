/**
 * 채널별 알림 수준(0027 channel_members.notify_level).
 *  - all      모든 새 글 — 푸시(채널 최상위 글·멘션·스레드)
 *  - mentions 멘션만 — 멘션과 내가 참여한 스레드 답글만
 *  - off      끔 — 푸시·메일·활동 모두 없음, 사이드바 배지도 흐리게(기존 뮤트)
 * DB 에는 null(기본)도 있다: 채널은 mentions, DM·그룹 채팅은 all.
 * 기존 boolean muted 는 notify_level = 'off' 와 DB 트리거가 항상 맞춘다.
 */
export const NOTIFY_LEVELS = ['all', 'mentions', 'off'] as const
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number]

export function isNotifyLevel(value: unknown): value is NotifyLevel {
  return typeof value === 'string' && (NOTIFY_LEVELS as readonly string[]).includes(value)
}

export const NOTIFY_LEVEL_LABEL: Record<NotifyLevel, string> = {
  all: '모든 새 글',
  mentions: '멘션만',
  off: '끔',
}

export const NOTIFY_LEVEL_HINT: Record<NotifyLevel, string> = {
  all: '이 대화의 새 글마다 알려 줍니다.',
  mentions: '나를 멘션하거나 내가 참여한 스레드에 답글이 달릴 때만 알려 줍니다.',
  off: '푸시·메일·활동 알림을 모두 멈춥니다.',
}

type ChatKind = 'public' | 'private' | 'dm'

/** 저장값(null=기본)을 실제로 적용되는 수준으로. */
export function effectiveNotifyLevel(
  stored: string | null | undefined,
  kind: ChatKind
): NotifyLevel {
  if (isNotifyLevel(stored)) return stored
  return kind === 'dm' ? 'all' : 'mentions'
}

/**
 * 고를 수 있는 수준. 1:1 DM 은 상대의 모든 글이 곧 나에게 온 글이라 "멘션만"이 의미 없다.
 */
export function notifyLevelOptions(kind: ChatKind, isGroup: boolean): readonly NotifyLevel[] {
  if (kind === 'dm' && !isGroup) return ['all', 'off']
  return NOTIFY_LEVELS
}

/** 기본값과 같으면 null 로 저장해 "기본"을 유지한다(나중에 기본이 바뀌어도 따라간다). */
export function levelToStore(level: NotifyLevel, kind: ChatKind): NotifyLevel | null {
  return level === effectiveNotifyLevel(null, kind) ? null : level
}
