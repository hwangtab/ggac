import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { logSecurityEvent } from '@/utils/security'
import { deleteObject } from '@/lib/storage/blob'
import { isSafeMailboxAttachmentPath } from '@/lib/storage/mailboxAttachments'
import { logUserActivity } from '@/db/queries/activities'
import {
  deleteInboundEmailReturningPaths,
  getInboundEmail,
  listAttachmentsForEmail,
  listRepliesForEmail,
  listThread,
  getSentMailSummary,
  updateInboundStatus,
} from '@/db/queries/mailbox'
import { listNotesForEmail } from '@/db/queries/mailboxNotes'
import { listLabelsForEmail } from '@/db/queries/mailboxLabels'
import { getDisplayNames } from '@/db/queries/work/directory'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_STATUSES = ['unread', 'read', 'replied', 'archived', 'spam'] as const

// GET: 메일 한 건 상세 + 첨부 목록 + 보낸 답장 + 같은 대화의 메일 목록 (이사·감사·관리자, 브리프 A)
// `thread`는 본문 없이 머리글만 싣는다 — 같은 대화의 다른 메일은 각자의 상세로 연다.
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox/[id]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'board-member',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('메일을 조회하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ params, auth }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) {
      throw ApiError.badRequest('유효한 id가 필요합니다.')
    }
    const id = idValidation.sanitized

    const email = await getInboundEmail(id)
    if (!email) {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }

    const threadId = email.thread_id ? String(email.thread_id) : null
    const assignedTo = email.assigned_to ? String(email.assigned_to) : null
    // 우리가 새로 작성해 보낸 메일에 온 답장이면 그 보낸 메일의 머리글 — 화면이 "보낸 편지함의 …"으로 보여 준다.
    // 보낸 메일이 지워졌으면 null(그 칸은 ON DELETE SET NULL이라 보통은 이미 비어 있다).
    const replyToOutboundId = email.reply_to_outbound_id ? String(email.reply_to_outbound_id) : null
    const [attachments, replies, thread, notes, names, labels, sentReplyTo] = await Promise.all([
      listAttachmentsForEmail(id),
      listRepliesForEmail(id),
      threadId ? listThread(threadId) : Promise.resolve([]),
      listNotesForEmail(id),
      assignedTo ? getDisplayNames([assignedTo]) : Promise.resolve(new Map<string, string>()),
      listLabelsForEmail(id),
      replyToOutboundId ? getSentMailSummary(replyToOutboundId) : Promise.resolve(null),
    ])
    return ApiSuccess.ok({
      email: {
        ...email,
        assignee_name: assignedTo ? (names.get(assignedTo) ?? null) : null,
        labels,
        sent_reply_to: sentReplyTo,
      },
      attachments,
      replies,
      thread,
      notes,
      can_manage: auth.isAdmin,
      // 화면이 "내 메모"(고치기·지우기 버튼)를 가리는 데 쓴다. 판정 자체는 메모 라우트가 다시 한다.
      viewer_id: auth.user.id,
    })
  },
})

// PATCH: 낙관적 동시성으로 상태 변경
export const PATCH = defineApiRoute<{ status?: string; expected_status?: string }>({
  method: 'PATCH',
  name: 'api/admin/mailbox/[id]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('상태를 변경하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ body, params }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) {
      throw ApiError.badRequest('유효한 id가 필요합니다.')
    }
    const id = idValidation.sanitized
    const next = String(body?.status ?? '')
    const expected = String(body?.expected_status ?? '')
    if (!ALLOWED_STATUSES.includes(next as (typeof ALLOWED_STATUSES)[number])) {
      throw ApiError.badRequest('알 수 없는 상태입니다.')
    }

    const outcome = await updateInboundStatus(id, expected, next)
    if (outcome === 'missing') {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }
    if (outcome === 'conflict') {
      // 다른 관리자가 먼저 바꿨다. 화면이 재조회하도록 409로 알린다.
      return ApiError.conflict('다른 곳에서 이미 상태가 바뀌었습니다.').toNextResponse()
    }
    return ApiSuccess.ok({ id, status: next })
  },
})

/**
 * 받은 메일 한 건 삭제 — **관리자만**(2026-11-09).
 *
 * 메일함 보관 정책은 "계속 보관"이지만, 정보주체가 자기 메일의 삭제를 요구했을 때 응답할 수단이
 * 없었다. 이 경로가 그 최소 장치다: 행(첨부·답장·메모·라벨은 cascade)과 **비공개 저장소의 첨부
 * 파일**을 함께 지우고, 지운 사실을 활동 기록과 보안 로그에 남긴다(누가 언제 무엇을 지웠는지).
 *
 * 되돌릴 수 없으므로 관리자로 제한하고, 화면은 확인을 한 번 받는다.
 */
export const DELETE = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'DELETE',
  name: 'api/admin/mailbox/[id].delete',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox_delete'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '서버 오류가 발생했습니다.' }, 'medium')
    return ApiError.internalServerError('메일을 삭제하는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ params, auth, request }) => {
    const idValidation = validateUUID(String(params.id ?? ''), '메일 ID')
    if (!idValidation.isValid) {
      throw ApiError.badRequest('유효한 id가 필요합니다.')
    }
    const id = idValidation.sanitized

    const email = await getInboundEmail(id)
    if (!email) {
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }

    const { deleted, blobPaths } = await deleteInboundEmailReturningPaths(id)
    if (!deleted) {
      // 그 사이 다른 관리자가 지웠다. 결과는 같으므로 404로 알린다.
      throw ApiError.notFound('메일을 찾을 수 없습니다.')
    }

    // 첨부 파일은 행을 지운 뒤 별도로 지운다. 경로 규약을 벗어난 값은 건드리지 않는다.
    for (const path of blobPaths) {
      if (!isSafeMailboxAttachmentPath(path)) continue
      try {
        await deleteObject('private', path)
      } catch (error) {
        // 메일은 이미 사라졌다. 남은 파일은 로그로 남겨 사람이 정리한다(조용히 넘기지 않는다).
        logSecurityEvent(
          'ADMIN_MAILBOX_API_ERROR',
          { error: '첨부 파일 삭제 실패', path },
          'medium'
        )
        void error
      }
    }

    try {
      await logUserActivity({
        user_id: auth.user.id,
        action_type: 'admin_action',
        target_type: 'inbound_email',
        target_id: id,
        metadata: {
          action: 'mailbox_email_delete',
          attachments: blobPaths.length,
          subject_present: Boolean(email.subject),
        },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch {
      // 이미 지웠다. 기록 실패가 삭제를 되돌리거나 오류로 보이게 하지 않는다.
      logSecurityEvent('ADMIN_MAILBOX_API_ERROR', { error: '삭제 기록 실패' }, 'medium')
    }

    return ApiSuccess.ok({ id, deleted: true, attachments: blobPaths.length }, '메일을 지웠습니다.')
  },
})
