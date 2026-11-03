'use server'

import { after } from 'next/server'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  canPostRestricted,
  isWorkAdmin,
  loadChannelAccess,
  loadMessageAccess,
  viewerOf,
} from '@/lib/server/boardWorkChannelAuth'
import {
  editMessageBody,
  hasAllLevelWatcher,
  insertMessage,
  recordMentionRows,
  softDeleteMessage,
  toggleBookmarkRow,
  togglePinRow,
  toggleReactionRow,
} from '@/db/queries/work/messages'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { clearTyping } from '@/db/queries/work/sync'
import { logAudit } from '@work/lib/audit/log'
import { sanitizeUserMarkdown } from '@work/lib/markdown/sanitize-markdown'
import {
  dbFailure,
  fail,
  FORBIDDEN_MESSAGE,
  invalid,
  ok,
  type ActionResult,
} from '@work/lib/channels/action-result'
import { writeLimited } from '@work/lib/channels/action-support'
import { uuidSchema } from '@work/lib/channels/schema'
import { boundedArray } from '@work/lib/validation/bounded-array'
import { extractMentionIds, hasChannelMention } from './mentions'
import { notifyChannel, notifyDm, notifyMention, notifyThreadReply } from '@work/lib/push/notify'
import { pushTriggersFor, type PushTrigger } from './push-triggers'
import {
  fetchAttachmentsFor,
  fetchMessage,
  fetchMessagePage,
  fetchMessagesByIds,
  fetchPinnedIds,
  fetchPinnedMessages,
  fetchThread,
} from './queries'
import {
  editMessageSchema,
  loadOlderSchema,
  messageIdSchema,
  pinSchema,
  reactionSchema,
  sendMessageSchema,
  threadSchema,
} from './schema'
import type { AttachmentRow, ChatMessage, MessagePage } from './types'

/**
 * 메시지 server action — 원본 kosmart-work `lib/messages/actions.ts`와 **같은 이름·입력·반환 모양**.
 *
 * 원본은 RLS 클라이언트로 썼고 작성자·kind·카운터·보관 채널·공지 채널은 DB 트리거가 강제했다. 여기서는:
 *  - 권한(채널 멤버인가·읽을 수 있나·관리자인가)은 이 파일이 `boardWorkChannelAuth`로 판정하고
 *  - 데이터 규칙(작성자 강제·답글 1단계·같은 채널 인용·보관 채널·답글 수 재계산·rev)은 쿼리 계층
 *    (`src/db/queries/work/messages.ts`)이 같은 트랜잭션에서 지킨다.
 * 멘션 행 생성은 메시지 저장의 곁가지라 실패해도 메시지는 성공으로 돌려준다(mentionsFailed).
 * 푸시(5단계)는 저장 뒤 `schedulePush`가 응답 뒤(after)에 보낸다(아래).
 */

async function recordMentions(opts: {
  messageId: string
  body: string
  authorId: string
}): Promise<{ ids: string[]; failed: boolean }> {
  const explicit = extractMentionIds(opts.body)
  const everyone = hasChannelMention(opts.body)
  if (explicit.length === 0 && !everyone) return { ids: [], failed: false }
  try {
    const ids = await recordMentionRows({
      messageId: opts.messageId,
      authorId: opts.authorId,
      explicitIds: explicit,
      everyone,
    })
    return { ids, failed: false }
  } catch (e) {
    console.error('[recordMentions] 멘션 저장 실패:', e)
    return { ids: [], failed: true }
  }
}

const NOTIFIERS: Record<PushTrigger, (messageId: string) => Promise<unknown>> = {
  mention: notifyMention,
  dm: notifyDm,
  thread: notifyThreadReply,
  channel: notifyChannel,
}

/**
 * 저장 직후 푸시 예약 — 원본 schedulePush. 응답을 붙잡지 않도록 next/server `after()`로 응답 뒤에 돌린다.
 * 채널 새 글 푸시(0027)는 알림 수준을 '모든 새 글'로 둔 다른 멤버가 있을 때만 예약한다(없으면 after 도 안 돈다 —
 * 쿼리 계층 `hasAllLevelWatcher`). notify* 는 던지지 않지만, 혹시 모를 실패도 로그만 남긴다(메시지 전송은 이미 성공).
 * 누구에게 보낼지(알림 수준·방해 금지·이사회 권한·읽기 범위)는 notify.ts 가 보내는 순간 다시 판정한다.
 */
async function schedulePush(opts: {
  messageId: string
  channelId: string
  authorId: string
  channelKind: 'public' | 'private' | 'dm'
  parentId: string | null
  mentioned: string[]
}): Promise<void> {
  let channelPush = false
  if (opts.channelKind !== 'dm' && !opts.parentId) {
    channelPush = await hasAllLevelWatcher(opts.channelId, opts.authorId).catch(e => {
      console.error('[sendMessage] 알림 수준 조회 실패(채널 새 글 푸시 건너뜀):', e)
      return false
    })
  }
  const triggers = pushTriggersFor({
    channelKind: opts.channelKind,
    mentioned: opts.mentioned,
    parentId: opts.parentId,
    channelPush,
  })
  if (triggers.length === 0) return
  const run = async () => {
    for (const t of triggers) {
      try {
        await NOTIFIERS[t](opts.messageId)
      } catch (e) {
        console.error(`[sendMessage] 푸시(${t}) 실패:`, e)
      }
    }
  }
  try {
    after(run)
  } catch {
    // 요청 범위 밖(테스트·스크립트) — 기다리지 않고 돌린다
    void run()
  }
}

/**
 * 메시지 보내기. messageId는 클라이언트가 미리 만든 uuid(낙관 표시·폴링 중복 제거용).
 * attachmentIds는 검증만 하고 그대로 돌려준다 — 첨부 연결은 입력창이 전송 직후 `attachUploads(messageId, ids)`로 한다
 * (원본과 같다, src/work/lib/files/actions.ts). 승격이 메시지 첨부 수와 rev를 올려 다른 화면은 폴링으로 첨부를 다시 읽는다.
 */
export async function sendMessage(input: unknown): Promise<
  ActionResult<{
    message: ChatMessage
    attachmentIds: string[]
    mentioned: string[]
    /** 멘션 행 저장 실패(메시지는 저장됨) — 입력창이 안내를 띄운다 */
    mentionsFailed?: boolean
  }>
> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = sendMessageSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const { channelId, messageId, parentId, quotedMessageId } = parsed.data
  const body = sanitizeUserMarkdown(parsed.data.body.replace(/\s+$/, ''))
  const viewer = viewerOf(ctx)

  let access: Awaited<ReturnType<typeof loadChannelAccess>>
  try {
    access = await loadChannelAccess(viewer, channelId)
  } catch (e) {
    return dbFailure('sendMessage:access', e)
  }
  // 원본 messages_insert 정책: 채널 멤버만 쓴다(관리자도 참여해서 쓴다)
  if (!access || !access.isMember) return fail('이 채널에 메시지를 쓸 수 없습니다.')

  try {
    const result = await insertMessage({
      id: messageId,
      channelId,
      authorId: user.id,
      body,
      parentId: parentId ?? null,
      quotedMessageId: quotedMessageId ?? null,
      canPostRestricted: canPostRestricted(viewer, access),
    })
    if (result.status === 'duplicate') {
      // 같은 id 재전송(네트워크 재시도) — 내가 보낸 행이면 그대로 돌려준다(멱등)
      const existing =
        result.authorId === user.id ? await fetchMessage(ctx, messageId).catch(() => null) : null
      if (existing) {
        return ok({
          message: existing,
          attachmentIds: parsed.data.attachmentIds ?? [],
          mentioned: [],
        })
      }
      return fail('메시지를 보내지 못했습니다.')
    }
  } catch (e) {
    if (isWorkWriteError(e, 'forbidden')) return fail('참여한 채널에서만 글을 쓸 수 있습니다.')
    if (isWorkWriteError(e, 'owners_only')) return fail('이 채널은 소유자만 글을 올릴 수 있습니다.')
    if (isWorkWriteError(e, 'archived') || isWorkWriteError(e, 'not_found')) {
      return fail('이 채널에 메시지를 쓸 수 없습니다.')
    }
    if (isWorkWriteError(e, 'invalid_quote')) return fail('인용할 수 없는 메시지입니다.')
    if (isWorkWriteError(e, 'invalid_parent')) return fail('답글을 달 수 없는 메시지입니다.')
    return dbFailure('sendMessage', e)
  }

  // ggac 이식(폴링): 보낸 사람의 "입력 중"을 바로 지운다(행이 5초 남아 다음 폴에 다시 실리지 않게). 곁가지라 실패는 로그만
  await clearTyping(channelId, parentId ?? '', user.id).catch(e =>
    console.error('[sendMessage] 입력 중 표시 지우기 실패:', e)
  )
  const { ids: mentioned, failed: mentionsFailed } = await recordMentions({
    messageId,
    body,
    authorId: user.id,
  })
  await schedulePush({
    messageId,
    channelId,
    authorId: user.id,
    channelKind: access.kind,
    parentId: parentId ?? null,
    mentioned,
  }).catch(e => console.error('[sendMessage] 푸시 예약 실패:', e))

  const message = await fetchMessage(ctx, messageId).catch(e => {
    console.error('[sendMessage] 확정 행 조회 실패:', e)
    return null
  })
  if (!message) return fail('메시지를 보냈지만 결과를 불러오지 못했습니다.')
  return ok({
    message,
    attachmentIds: parsed.data.attachmentIds ?? [],
    mentioned,
    ...(mentionsFailed ? { mentionsFailed: true } : {}),
  })
}

/** 본문 수정(작성자 본인, 삭제 전). edited_at은 쿼리 계층이 찍는다 */
export async function editMessage(
  input: unknown
): Promise<ActionResult<{ message: ChatMessage; mentionsFailed?: boolean }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = editMessageSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const body = sanitizeUserMarkdown(parsed.data.body.replace(/\s+$/, ''))

  const current = await fetchMessage(ctx, parsed.data.messageId).catch(e => {
    console.error('[editMessage]', e)
    return null
  })
  if (!current) return fail('메시지를 찾을 수 없습니다.')
  if (current.author_id !== user.id || current.kind !== 'text') {
    return fail('내가 쓴 메시지만 고칠 수 있습니다.')
  }
  if (current.deleted_at) return fail('삭제된 메시지는 고칠 수 없습니다.')
  if (current.forwarded_from_id) return fail('전달된 메시지는 고칠 수 없습니다.')
  if (current.body === body) return ok({ message: current })

  const viewer = viewerOf(ctx)
  const access = await loadChannelAccess(viewer, current.channel_id).catch(() => null)
  // 원본 messages_update 정책: (작성자이면서 채널 멤버) 또는 (관리자이면서 읽을 수 있음)
  const admin = isWorkAdmin(viewer) && Boolean(access?.canRead)
  if (!access || (!access.isMember && !admin)) return fail(FORBIDDEN_MESSAGE)

  try {
    await editMessageBody({ messageId: current.id, actorId: user.id, body, actorIsAdmin: admin })
  } catch (e) {
    if (isWorkWriteError(e)) return fail(FORBIDDEN_MESSAGE)
    return dbFailure('editMessage', e)
  }
  const { failed } = await recordMentions({ messageId: current.id, body, authorId: user.id })
  const message = await fetchMessage(ctx, current.id).catch(() => null)
  if (!message) return fail(FORBIDDEN_MESSAGE)
  return ok({ message, ...(failed ? { mentionsFailed: true } : {}) })
}

/** 소프트 삭제(작성자·관리자). 본문은 쿼리 계층이 비운다 */
export async function deleteMessage(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = messageIdSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  const current = await fetchMessage(ctx, parsed.data.messageId).catch(e => {
    console.error('[deleteMessage]', e)
    return null
  })
  if (!current) return fail('메시지를 찾을 수 없습니다.')
  if (current.deleted_at) return ok({ id: current.id })
  if (current.author_id !== user.id && !isWorkAdmin(viewer)) {
    return fail('내가 쓴 메시지만 삭제할 수 있습니다.')
  }
  const access = await loadChannelAccess(viewer, current.channel_id).catch(() => null)
  const admin = isWorkAdmin(viewer) && Boolean(access?.canRead)
  const authorMember = current.author_id === user.id && Boolean(access?.isMember)
  if (!authorMember && !admin) return fail(FORBIDDEN_MESSAGE)

  try {
    await softDeleteMessage({ messageId: current.id, actorId: user.id, actorIsAdmin: admin })
  } catch (e) {
    if (isWorkWriteError(e)) return fail(FORBIDDEN_MESSAGE)
    return dbFailure('deleteMessage', e)
  }
  // 관리자가 남의 메시지를 지운 경우만 감사 기록(본문은 남기지 않는다)
  if (current.author_id !== user.id) {
    await logAudit(
      user.id,
      'message.admin_delete',
      { type: 'message', id: current.id },
      {
        channel_id: current.channel_id,
        author_id: current.author_id,
        attachments: current.attachments_count,
      }
    )
  }
  return ok({ id: current.id })
}

/** 반응 토글. 결과 상태(active=true면 내 반응이 있음)를 돌려준다 */
export async function toggleReaction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = reactionSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const { messageId, emoji } = parsed.data

  const access = await loadMessageAccess(viewerOf(ctx), messageId).catch(() => null)
  // 읽을 수 없는 채널의 메시지는 있는지조차 알리지 않는다(원본 reactions_select)
  if (!access?.canRead) return fail('참여한 채널에서만 반응할 수 있습니다.')
  try {
    const { active } = await toggleReactionRow({
      messageId,
      userId: user.id,
      emoji,
      canAdd: access.isMember,
    })
    return ok({ active })
  } catch (e) {
    if (isWorkWriteError(e)) return fail('참여한 채널에서만 반응할 수 있습니다.')
    return dbFailure('toggleReaction', e)
  }
}

/** 고정 토글(채널 멤버) */
export async function togglePin(input: unknown): Promise<ActionResult<{ pinned: boolean }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = pinSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const { channelId, messageId } = parsed.data

  const access = await loadChannelAccess(viewerOf(ctx), channelId).catch(() => null)
  if (!access?.isMember) return fail('참여한 채널에서만 고정할 수 있습니다.')
  try {
    return ok(await togglePinRow({ channelId, messageId, actorId: user.id }))
  } catch (e) {
    if (isWorkWriteError(e, 'invalid_target')) return fail('이 채널의 메시지가 아닙니다.')
    if (isWorkWriteError(e)) return fail('참여한 채널에서만 고정할 수 있습니다.')
    return dbFailure('togglePin', e)
  }
}

/** 북마크 토글(본인) */
export async function toggleBookmark(
  input: unknown
): Promise<ActionResult<{ bookmarked: boolean }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = messageIdSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited

  const access = await loadMessageAccess(viewerOf(ctx), parsed.data.messageId).catch(() => null)
  try {
    return ok(
      await toggleBookmarkRow({
        userId: user.id,
        messageId: parsed.data.messageId,
        canAdd: Boolean(access?.canRead),
      })
    )
  } catch (e) {
    if (isWorkWriteError(e)) return fail(FORBIDDEN_MESSAGE)
    return dbFailure('toggleBookmark', e)
  }
}

/** 위로 스크롤: before 커서보다 오래된 최상위 메시지 50개 */
export async function loadOlderMessages(input: unknown): Promise<ActionResult<MessagePage>> {
  const ctx = await requireWorkStaff()
  const parsed = loadOlderSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await fetchMessagePage(ctx, parsed.data.channelId, { before: parsed.data.before }))
  } catch (e) {
    return dbFailure('loadOlderMessages', e)
  }
}

/** 재연결 후 빈틈 메우기: 최신 50개 */
export async function loadLatestMessages(input: unknown): Promise<ActionResult<MessagePage>> {
  const ctx = await requireWorkStaff()
  const parsed = uuidSchema.safeParse((input as { channelId?: unknown } | null)?.channelId)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await fetchMessagePage(ctx, parsed.data))
  } catch (e) {
    return dbFailure('loadLatestMessages', e)
  }
}

/** 스레드(부모 + 답글) */
export async function loadThread(
  input: unknown
): Promise<ActionResult<{ parent: ChatMessage; replies: ChatMessage[] }>> {
  const ctx = await requireWorkStaff()
  const parsed = threadSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    const thread = await fetchThread(ctx, parsed.data.parentId)
    if (!thread) return fail('스레드를 찾을 수 없습니다.')
    return ok(thread)
  } catch (e) {
    return dbFailure('loadThread', e)
  }
}

/** 메시지들의 첨부(실시간 갱신 재조회 — 읽을 수 있는 채널의 지워지지 않은 메시지만) */
export async function loadMessageAttachments(
  input: unknown
): Promise<ActionResult<Record<string, AttachmentRow[]>>> {
  const ctx = await requireWorkStaff()
  const raw = (input as { messageIds?: unknown } | null)?.messageIds
  const parsed = boundedArray(uuidSchema, { min: 1, max: 100 }).safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await fetchAttachmentsFor(ctx, parsed.data))
  } catch (e) {
    return dbFailure('loadMessageAttachments', e)
  }
}

/**
 * 폴링 신호 재조회: 동기화 응답(`messageIds`)이 알려 온 메시지 id를 읽기 범위 안에서 다시 읽는다.
 * 읽을 수 없거나 없는 메시지는 결과에 없다(원본과 같다).
 */
export async function loadMessagesByIds(input: unknown): Promise<ActionResult<ChatMessage[]>> {
  const ctx = await requireWorkStaff()
  const raw = (input as { messageIds?: unknown } | null)?.messageIds
  const parsed = boundedArray(uuidSchema, { min: 1, max: 100 }).safeParse(raw)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await fetchMessagesByIds(ctx, [...new Set(parsed.data)]))
  } catch (e) {
    return dbFailure('loadMessagesByIds', e)
  }
}

/** 고정 메시지 목록(우측 패널) */
export async function loadPinnedMessages(input: unknown): Promise<ActionResult<ChatMessage[]>> {
  const ctx = await requireWorkStaff()
  const parsed = uuidSchema.safeParse((input as { channelId?: unknown } | null)?.channelId)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await fetchPinnedMessages(ctx, parsed.data))
  } catch (e) {
    return dbFailure('loadPinnedMessages', e)
  }
}

/** 고정된 메시지 id(머리글 고정 수 — 폴링이 pinsChanged를 알리면 다시 읽는다) */
export async function loadPinnedIds(input: unknown): Promise<ActionResult<string[]>> {
  const ctx = await requireWorkStaff()
  const parsed = uuidSchema.safeParse((input as { channelId?: unknown } | null)?.channelId)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await fetchPinnedIds(ctx, parsed.data))
  } catch (e) {
    return dbFailure('loadPinnedIds', e)
  }
}
