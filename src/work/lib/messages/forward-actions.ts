'use server'

import { after } from 'next/server'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  canPostRestricted,
  isWorkAdmin,
  loadChannelAccess,
  viewerOf,
} from '@/lib/server/boardWorkChannelAuth'
import { getChannelRecordById, listMyOwnersPolicyChannels } from '@/db/queries/work/channels'
import { getDisplayNames } from '@/db/queries/work/directory'
import { insertForwardedMessage } from '@/db/queries/work/messages'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { otherDmUserId } from '@work/lib/channels/dm'
import { listSidebarChannels } from '@work/lib/channels/queries'
import { channelHref } from '@work/components/layout/channel-items'
import {
  dbFailure,
  fail,
  FORBIDDEN_MESSAGE,
  invalid,
  ok,
  type ActionResult,
} from '@work/lib/channels/action-result'
import { writeLimited } from '@work/lib/channels/action-support'
import { logAudit } from '@work/lib/audit/log'
import { notifyChannel, notifyDm } from '@work/lib/push/notify'
import { sanitizeUserMarkdown } from '@work/lib/markdown/sanitize-markdown'
import {
  buildForwardBody,
  forwardInputSchema,
  needsForwardConfirm,
  planAttachmentForward,
  type ForwardTarget,
} from './forward'
import { fetchAttachmentsFor, fetchMessage, fetchMessageWithSensitive } from './queries'
import type { ChatMessage } from './types'

/**
 * 전달 server action — 원본 kosmart-work `lib/messages/forward-actions.ts`와 같은 이름·입력·반환 모양.
 * 원본은 forwarded_from_id를 싣기 위해 service_role로 썼고, 그래서 이 파일이 RLS가 하던 검사를 직접 했다:
 * 원본을 읽을 수 있나 · 대상 대화의 멤버인가 · 보관 안 됐나 · 공지 채널이면 owner/관리자인가. 여기서도 같다.
 * 첨부 복제는 2단계(파일) — 지금은 첨부가 늘 없으므로 copied 0, linkOnly false, failed 0이다.
 */

type ForwardResult = {
  message: ChatMessage
  href: string
  attachmentsCopied: number
  attachmentsLinkOnly: boolean
  attachmentsFailed: number
}

/** 대화상자에 보일 대상: 내가 멤버인 보관 안 된 채널·DM·그룹. 공지 채널이라 쓸 수 없으면 restricted */
export async function listForwardTargets(): Promise<ActionResult<ForwardTarget[]>> {
  const ctx = await requireWorkStaff()
  const viewer = viewerOf(ctx)
  let sidebar: Awaited<ReturnType<typeof listSidebarChannels>>
  let owners: { id: string; role: 'owner' | 'member' }[]
  try {
    ;[sidebar, owners] = await Promise.all([
      listSidebarChannels(ctx, ctx.user.id),
      listMyOwnersPolicyChannels(ctx.user.id),
    ])
  } catch (e) {
    return dbFailure('listForwardTargets', e)
  }
  const canPostAnywhere = isWorkAdmin(viewer)
  const restrictedIds = new Set(
    owners.filter(c => !canPostAnywhere && c.role !== 'owner').map(c => c.id)
  )
  const toTarget = (c: (typeof sidebar.channels)[number]): ForwardTarget => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    group: Boolean(c.group),
    restricted: restrictedIds.has(c.id),
  })
  return ok([...sidebar.channels.map(toTarget), ...sidebar.dms.map(toTarget)])
}

export async function forwardMessage(input: unknown): Promise<ActionResult<ForwardResult>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = forwardInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const { messageId, targetChannelId, comment, confirmed, id: clientId } = parsed.data
  const viewer = viewerOf(ctx)

  // 1. 원본 — 읽을 수 있어야 한다(읽기 범위 밖이면 없는 것과 같다)
  let found: Awaited<ReturnType<typeof fetchMessageWithSensitive>>
  try {
    found = await fetchMessageWithSensitive(ctx, messageId)
  } catch (e) {
    return dbFailure('forwardMessage', e)
  }
  const original = found?.message ?? null
  if (!original || original.deleted_at) return fail('전달할 메시지를 찾을 수 없습니다.')
  if (original.kind === 'system') return fail('시스템 메시지는 전달할 수 없습니다.')
  // 민감 표시는 전달본이 이어받는다
  const sensitive = found?.sensitive ?? false

  let source: Awaited<ReturnType<typeof getChannelRecordById>>
  try {
    source = await getChannelRecordById(original.channel_id)
  } catch (e) {
    return dbFailure('forwardMessage', e)
  }
  if (!source) return fail('전달할 메시지를 찾을 수 없습니다.')
  if (needsForwardConfirm(source.kind) && !confirmed) {
    return fail('비공개 대화의 메시지는 확인 뒤에 전달할 수 있습니다.')
  }

  // 2. 대상 — 내가 멤버, 보관 안 됨, 공지 채널이면 owner/관리자
  let target: Awaited<ReturnType<typeof loadChannelAccess>>
  try {
    target = await loadChannelAccess(viewer, targetChannelId)
  } catch (e) {
    return dbFailure('forwardMessage', e)
  }
  if (!target || !target.isMember) return fail(FORBIDDEN_MESSAGE)
  if (target.archived) return fail('보관된 채널에는 쓸 수 없습니다.')
  if (target.postPolicy === 'owners' && !canPostRestricted(viewer, target)) {
    return fail('이 채널은 소유자만 글을 올릴 수 있습니다.')
  }

  // 3. 이름표(원 작성자 · 원 대화)
  const peerId =
    source.kind === 'dm' && !source.is_group ? otherDmUserId(source.dm_key, user.id) : null
  const names = await getDisplayNames(
    [peerId, original.author_id].filter((v): v is string => !!v)
  ).catch(() => new Map<string, string>())
  let conversationName: string
  if (source.kind === 'dm') {
    if (source.is_group) {
      conversationName = source.title?.trim() || '그룹 대화'
    } else {
      const peerName = peerId && peerId !== user.id.toLowerCase() ? names.get(peerId) : null
      conversationName = peerName ? `${peerName}님과의 대화` : '다이렉트 메시지'
    }
  } else {
    conversationName = `#${source.name}`
  }
  const authorName = original.author_id
    ? (names.get(original.author_id) ?? '알 수 없는 사용자')
    : original.kind === 'bot'
      ? '봇'
      : '알 수 없는 사용자'

  const body = sanitizeUserMarkdown(
    buildForwardBody({ comment, authorName, conversationName, originalBody: original.body })
  )

  // 4. 첨부 계획 — 2단계 전까지 첨부는 늘 없다
  const attachments = (await fetchAttachmentsFor(ctx, [original.id]))[original.id] ?? []
  const plan = planAttachmentForward(attachments)

  // 5. 저장 — 모든 권한 확인을 통과한 뒤에만 도달한다
  const newId = clientId ?? crypto.randomUUID()
  let duplicate = false
  try {
    const result = await insertForwardedMessage({
      id: newId,
      channelId: targetChannelId,
      authorId: user.id,
      body: plan.linkOnly
        ? `${body}\n>\n> (첨부 ${attachments.length}개는 원문에서 볼 수 있습니다)`
        : body,
      forwardedFromId: original.id,
      sensitive,
      canPostRestricted: canPostRestricted(viewer, target),
    })
    // 같은 id로 이미 전달됨(재시도·더블클릭) — 같은 대상·같은 원본이면 그 결과를 돌려준다
    if (result.status === 'conflict') return dbFailure('forwardMessage', new Error('id 충돌'))
    duplicate = result.status === 'duplicate'
  } catch (e) {
    if (isWorkWriteError(e, 'forbidden')) return fail('참여한 채널에서만 글을 쓸 수 있습니다.')
    if (isWorkWriteError(e, 'owners_only')) return fail('이 채널은 소유자만 글을 올릴 수 있습니다.')
    if (isWorkWriteError(e, 'archived')) return fail('보관된 채널에는 쓸 수 없습니다.')
    return dbFailure('forwardMessage', e)
  }
  if (!duplicate) {
    await logAudit(
      user.id,
      'message.forward',
      { type: 'message', id: newId },
      { source_channel_id: original.channel_id, target_channel_id: targetChannelId }
    )
  }

  // 6. 첨부 복제 — 2단계.
  // 7. 푸시(응답 뒤) — 원본처럼 대상이 DM이면 notifyDm, 아니면 notifyChannel. notify* 는 던지지 않는다
  const notify = target.kind === 'dm' ? notifyDm : notifyChannel
  const run = async () => {
    if (duplicate) return
    try {
      await notify(newId)
    } catch (e) {
      console.error('[forwardMessage] 푸시 실패:', e)
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }

  // 8. 대상 대화 경로 + 확정 행
  const message = await fetchMessage(ctx, newId).catch(e => {
    console.error('[forwardMessage] 확정 행 조회 실패:', e)
    return null
  })
  if (!message) {
    return fail('전달했지만 결과를 불러오지 못했습니다. 대화를 새로 열어 확인해 주세요.')
  }
  const targetInfo = await getChannelRecordById(targetChannelId).catch(() => null)
  return ok({
    message,
    href: channelHref({
      id: targetChannelId,
      slug: targetInfo?.slug ?? null,
      kind: targetInfo?.kind ?? target.kind,
    }),
    attachmentsCopied: 0,
    attachmentsLinkOnly: plan.linkOnly,
    attachmentsFailed: 0,
  })
}
