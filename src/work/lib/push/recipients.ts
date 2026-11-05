import { DEFAULT_QUIET, isQuietNow, type QuietPrefs } from '../notifications/quiet-hours.ts'

/**
 * 푸시 수신자 판정(순수) — 원본 kosmart-work RPC `push_recipients`(0027)의 WHERE 절을 옮겼다.
 * 후보 모으기는 쿼리 계층(`src/db/queries/work/push.ts` listPushCandidates)이 하고, 여기서는 누구에게 실제로 보낼지만 정한다.
 * `node --test`가 이 파일을 직접 읽는다 — 상대 import에 `.ts`를 붙이고 `@/` 별칭을 쓰지 않는다.
 *
 * 원본 규칙(0027 주석 그대로):
 *   mention  멘션된 사용자(알림 수준 '끔' 제외)
 *   dm       DM·그룹 멤버 — 수준 all(기본)이면 수신, mentions면 이 메시지에 멘션된 때만, 끔 제외
 *   thread   부모 작성자 + 같은 스레드 답글 작성자(끔 제외, 이미 멘션된 사람 제외 — 멘션 푸시가 따로 간다)
 *   channel  일반 채널 최상위 새 글 — 수준 'all'인 멤버(멘션된 사람 제외)
 *   공통     작성자 본인·채널 비멤버·방해 금지 시간대 사용자 제외
 *
 * ggac 이식에서 더한 것: 원본의 "활성 staff"(`staff.status='active'`) 자리는 **이사회 권한**(`canAccess`)이다 —
 * 이사에서 빠지면 멤버십 행이 남아 있어도 받지 못한다(설계 §3). 그리고 발송 시점에 **읽기 범위**를 다시 본다:
 * 멤버가 아니면(관리자라도 — 원본은 멤버만 보냈다) 보내지 않는다.
 */

export type PushReason = 'mention' | 'dm' | 'thread' | 'channel'

export type RecipientMessage = {
  authorId: string | null
  channelKind: 'public' | 'private' | 'dm'
  parentId: string | null
}

export type RecipientCandidate = {
  userId: string
  memberRole: 'owner' | 'member' | null
  notifyLevel: string | null
  quiet: QuietPrefs | null
  mentioned: boolean
}

/** 원본 `coalesce(cm.notify_level, case when dm then 'all' else 'mentions' end)` */
export function effectiveLevel(
  stored: string | null | undefined,
  kind: RecipientMessage['channelKind']
): 'all' | 'mentions' | 'off' {
  if (stored === 'all' || stored === 'mentions' || stored === 'off') return stored
  return kind === 'dm' ? 'all' : 'mentions'
}

/** 사유가 이 메시지에 성립하는가(원본 cand CTE의 사유별 조건) */
export function reasonApplies(reason: PushReason, message: RecipientMessage): boolean {
  switch (reason) {
    case 'mention':
      return true
    case 'dm':
      return message.channelKind === 'dm'
    case 'channel':
      return message.channelKind !== 'dm' && !message.parentId
    case 'thread':
      return Boolean(message.parentId)
    default:
      return false
  }
}

/** 알림 수준·멘션 중복 규칙(원본 `case p_reason …` + 끝의 `not exists mentions`) */
export function levelAllows(
  reason: PushReason,
  level: 'all' | 'mentions' | 'off',
  mentioned: boolean
): boolean {
  if ((reason === 'thread' || reason === 'channel') && mentioned) return false
  switch (reason) {
    case 'mention':
    case 'thread':
      return level !== 'off'
    case 'dm':
      return level === 'all' || (level === 'mentions' && mentioned)
    case 'channel':
      return level === 'all'
    default:
      return false
  }
}

/**
 * 보낼 사용자 id(중복 없음, 후보 순서 유지).
 * `canAccess(candidate)` — 이 사람이 **지금** 업무툴에 들어올 수 있고 이 채널을 읽을 수 있는가(호출부가
 * `canAccessBoardRoom` + `canReadChannelRow`로 판정한다). 거짓이면 다른 조건과 무관하게 뺀다.
 * `onlyUserIds` — 주면 이 사람들 가운데서만 고른다(대소문자 무시). 메시지를 고쳐 **새로** 멘션된 사람에게만 보낼 때 쓴다
 * (고치기 전부터 멘션돼 있던 사람에게 다시 보내지 않는다). 빈 목록이면 아무도 없다.
 */
export function selectPushRecipients<C extends RecipientCandidate>(input: {
  reason: PushReason
  message: RecipientMessage
  candidates: readonly C[]
  canAccess: (candidate: C) => boolean
  now?: Date
  onlyUserIds?: readonly string[]
}): string[] {
  const { reason, message } = input
  if (!reasonApplies(reason, message)) return []
  const now = input.now ?? new Date()
  const only = input.onlyUserIds ? new Set(input.onlyUserIds.map(id => id.toLowerCase())) : null
  if (only && only.size === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of input.candidates) {
    if (!c.userId || seen.has(c.userId)) continue
    if (only && !only.has(c.userId.toLowerCase())) continue
    if (message.authorId && c.userId === message.authorId) continue
    // 채널 비멤버 제외(원본 `join channel_members cm`) — 관리자가 비공개 채널을 읽을 수 있어도 멤버가 아니면 보내지 않는다
    if (!c.memberRole) continue
    if (!input.canAccess(c)) continue
    if (isQuietNow(c.quiet ?? DEFAULT_QUIET, now)) continue
    if (!levelAllows(reason, effectiveLevel(c.notifyLevel, message.channelKind), c.mentioned)) {
      continue
    }
    seen.add(c.userId)
    out.push(c.userId)
  }
  return out
}
