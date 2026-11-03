import { canAccessBoardRoom } from '@/lib/server/authz'
import { workRoleOf } from '@/lib/server/boardWorkAuth'
import { canReadChannelRow } from '@/lib/server/boardWorkChannelAuth'
import { listPushCandidates, loadPushMessageInfo, type PushCandidate } from '@/db/queries/work/push'
import { authorLabel } from '@work/lib/messages/author-label'
import { buildPushPayload, type PushReason } from './payload'
import { selectPushRecipients } from './recipients'
import { getVapidConfig, sendPushToUsers, type PushSendResult, type PushTransport } from './send'

/**
 * 푸시 발송 트리거 — 원본 kosmart-work `lib/push/notify.ts`. 메시지 저장(멘션 행 포함) **직후** 서버에서 부른다.
 *
 *   await notifyMention(messageId)      // 멘션된 사용자들에게
 *   await notifyDm(messageId)           // DM·그룹 채팅의 다른 멤버에게
 *   await notifyThreadReply(messageId)  // 부모 작성자 + 스레드 참여자에게(parent_id 가 있는 메시지)
 *   await notifyChannel(messageId)      // 채널 최상위 새 글 → 알림 수준 '모든 새 글'인 멤버에게
 *
 * 규약(원본 그대로)
 *  - 인자는 messageId 하나. 본문·채널·작성자는 여기서 다시 읽는다(클라이언트 값을 믿지 않는다).
 *  - 'use server' 파일이 아니다 → 클라이언트가 직접 부를 수 없다. 작성자 권한 검사와 insert 가 끝난 뒤에만 부른다.
 *  - 절대 던지지 않는다. 푸시 실패가 메시지 전송을 실패시키지 않는다(sendMessage 는 after() 로 응답 뒤에 돌린다).
 *  - 한 메시지가 멘션이면서 스레드 답글이면 둘 다 불러도 중복 푸시가 없다(thread·channel 은 멘션된 사람을 뺀다).
 *  - VAPID 환경변수가 없으면 no-op.
 *
 * 수신자 판정(원본 RPC push_recipients → `listPushCandidates` + `selectPushRecipients`)에 ggac 이식이 더한 것:
 * **보내는 순간 각 수신자의 이사회 권한과 채널 읽기 범위를 다시 본다**(`canAccessBoardRoom` + `canReadChannelRow`).
 * 이사에서 빠진 사람은 멤버십 행이 남아 있어도 받지 못한다(설계 §3).
 */

/** 이 후보가 지금 업무툴에 들어올 수 있고 이 채널을 읽을 수 있는가 */
export function candidateCanRead(
  candidate: PushCandidate,
  channelKind: 'public' | 'private' | 'dm'
): boolean {
  if (!canAccessBoardRoom(candidate.profile)) return false
  const role = workRoleOf(candidate.profile)
  if (!role) return false
  return canReadChannelRow(
    { userId: candidate.userId, role },
    { kind: channelKind, memberRole: candidate.memberRole }
  )
}

/** 수신자 id 목록(보내지는 않는다) — 시험·진단용으로 따로 둔다 */
export async function pushRecipientsFor(
  messageId: string,
  reason: PushReason,
  now: Date = new Date()
): Promise<string[]> {
  const found = await listPushCandidates(messageId, reason)
  if (!found) return []
  return selectPushRecipients({
    reason,
    message: found.message,
    candidates: found.candidates,
    canAccess: c => candidateCanRead(c, found.message.channelKind),
    now,
  })
}

async function notify(
  reason: PushReason,
  messageId: string,
  opts: { transport?: PushTransport } = {}
): Promise<PushSendResult> {
  const empty: PushSendResult = { sent: 0, failed: 0, removed: 0 }
  try {
    if (!getVapidConfig()) return { ...empty, skipped: 'not_configured' }
    const userIds = await pushRecipientsFor(messageId, reason)
    if (userIds.length === 0) return { ...empty, skipped: 'no_recipients' }

    const info = await loadPushMessageInfo(messageId)
    if (!info) return { ...empty, skipped: 'no_recipients' }
    const payload = buildPushPayload(reason, {
      messageId: info.messageId,
      parentId: info.parentId,
      channelId: info.channelId,
      channelName: info.channelName,
      channelSlug: info.channelSlug,
      channelKind: info.channelKind,
      isGroup: info.isGroup,
      groupTitle: info.groupTitle,
      authorName: authorLabel({
        kind: info.messageKind,
        authorName: info.authorName,
        body: info.body,
      }),
      body: info.body,
      sensitive: info.sensitive,
    })
    return await sendPushToUsers(userIds, payload, opts)
  } catch (err) {
    console.error(`[push] notify(${reason}) 예외:`, err)
    return { ...empty, failed: 1 }
  }
}

export function notifyMention(messageId: string): Promise<PushSendResult> {
  return notify('mention', messageId)
}

export function notifyDm(messageId: string): Promise<PushSendResult> {
  return notify('dm', messageId)
}

export function notifyThreadReply(messageId: string): Promise<PushSendResult> {
  return notify('thread', messageId)
}

/** 채널의 새 글 — 알림 수준을 '모든 새 글'로 둔 멤버에게만(0027 push_recipients 'channel'). */
export function notifyChannel(messageId: string): Promise<PushSendResult> {
  return notify('channel', messageId)
}
