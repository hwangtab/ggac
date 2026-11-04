import { randomUUID } from 'node:crypto'

import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import type { AdminAuthSuccess } from '@/lib/server/adminAuth'
import type { BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import {
  countInboundSince,
  countOutboundRecipientsSince,
  deleteOutboundAttachmentsForEmail,
  insertOutboundAttachment,
  insertOutboundSending,
  listSentMail,
  markOutboundSent,
  markOutboundStatus,
  type SentMailKind,
} from '@/db/queries/mailbox'
import { logUserActivity } from '@/db/queries/activities'
import { readSessionUser } from '@/lib/server/session'
import { MailSendError, sendEmail } from '@/lib/mail/send'
import {
  isTestRecipientAddress,
  validateCompose,
  validateAttachments,
} from '@/lib/mail/composeValidation'
import {
  dailyOutboundLimit,
  dailyTotalGuard,
  evaluateQuota,
  isComposeEnabled,
} from '@/lib/mail/composeQuota'
import { blobPathForSentAttachment } from '@/lib/storage/mailboxAttachments'
import { deleteObject, putObject } from '@/lib/storage/blob'
import { sanitizePostHtml } from '@/utils/sanitizePostHtml'
import { logSecurityEvent } from '@/utils/security'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/**
 * 첨부 Blob 쓰기(최대 5회, 순차) + Resend 호출(첨부가 있으면 최대 30초)이 한 요청 안에 든다. 시간 제한이
 * 이보다 짧으면 플랫폼이 함수를 먼저 끊어 `sending` 행이 남고, 클라이언트는 JSON 아닌 504를 받는다.
 */
export const maxDuration = 90

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_FIELD_JSON = 20_000

function parseAddressList(raw: FormDataEntryValue | null): unknown {
  if (raw === null || raw === '') return []
  if (typeof raw !== 'string' || raw.length > MAX_FIELD_JSON) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function plainTextLength(html: string): number {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim().length
}

// POST: 받은 메일과 무관한 새 메일을 작성해 보낸다(관리자만)
//
// 순서가 핵심이다 — 되돌릴 수 없는 일(발송)은 맨 끝에 한 번만 일어나고, 그 앞은 전부 DB 제약과 검증이 막는다.
//  1. 킬스위치 → 검증 → `sending` 행을 먼저 쓴다(idempotency_key UNIQUE가 중복 클릭을 막는다).
//  2. 행을 포함해 24시간 합계를 센다. 상한을 넘으면 `blocked`로 두고 보내지 않는다.
//  3. 첨부를 비공개 Blob에 쓰고 행을 남긴다. 여기서 실패해도 아직 아무것도 나가지 않았다.
//  4. 발송. 발송이 끝난 뒤의 기록 실패는 던지지 않는다 — 던지면 화면이 "실패"를 보여 주고 사람이
//     다시 눌러 이미 나간 메일이 한 번 더 간다(답장 라우트와 같은 원칙).
export const POST = defineApiRoute<undefined, AdminAuthSuccess>({
  method: 'POST',
  name: 'api/admin/mailbox/outbound',
  rateLimit: {
    ...RATE_LIMITS.MAILBOX_COMPOSE,
    keyGenerator: createUserKeyGenerator('admin_mailbox_compose'),
  },
  auth: 'admin',
  errorResponse: () => {
    logSecurityEvent(
      'ADMIN_MAILBOX_OUTBOUND_API_ERROR',
      { error: '서버 오류가 발생했습니다.' },
      'medium'
    )
    return ApiError.internalServerError('메일을 보내는 중 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ request, auth }) => {
    if (!isComposeEnabled()) {
      throw ApiError.forbidden('새 메일 작성 기능이 꺼져 있습니다.')
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw ApiError.badRequest('요청 형식이 올바르지 않습니다.')
    }

    const keyValidation = validateUUID(String(form.get('idempotency_key') ?? ''), '요청 키')
    if (!keyValidation.isValid) throw ApiError.badRequest('유효한 요청 키가 필요합니다.')
    const idempotencyKey = keyValidation.sanitized

    const toList = parseAddressList(form.get('to'))
    const ccList = parseAddressList(form.get('cc'))
    const bccList = parseAddressList(form.get('bcc'))
    if (toList === null || ccList === null || bccList === null) {
      throw ApiError.badRequest('수신자 형식이 올바르지 않습니다.')
    }
    const compose = validateCompose({
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: form.get('subject'),
    })
    if (compose.ok === false) throw ApiError.badRequest(compose.error)

    const rawHtml = String(form.get('body_html') ?? '').trim()
    if (!rawHtml) throw ApiError.badRequest('본문을 입력해 주세요.')
    if (rawHtml.length > 200_000) throw ApiError.badRequest('본문이 너무 깁니다.')
    const html = sanitizePostHtml(rawHtml)
    if (plainTextLength(html) === 0) throw ApiError.badRequest('본문을 입력해 주세요.')

    const files = form.getAll('attachments').filter((v): v is File => typeof v !== 'string')
    const attachmentCheck = validateAttachments(files.map(f => ({ name: f.name, size: f.size })))
    if (attachmentCheck.ok === false) throw ApiError.badRequest(attachmentCheck.error)
    const attachmentMeta = attachmentCheck.value

    const value = compose.value
    // 수신자가 전부 `@test.local`이면 실제로는 아무것도 나가지 않는다(validateCompose가 혼합을 막는다).
    // 한도에 세지 않아야 E2E가 업무 한도를 갉아먹지 않는다.
    const isTestOnly = value.to.every(isTestRecipientAddress)
    const { created, row } = await insertOutboundSending({
      idempotency_key: idempotencyKey,
      to_addresses: value.to,
      cc_addresses: value.cc,
      bcc_addresses: value.bcc,
      recipient_count: isTestOnly ? 0 : value.recipientCount,
      subject: value.subject,
      body_html: html,
      sent_by: auth?.user?.id ?? null,
      // 보낸 사람 프로필이 지워져도 누가 보냈는지 남긴다(`sent_by`는 ON DELETE SET NULL).
      // 값은 검증된 세션에서만 얻는다 — 폼 값은 받지 않는다.
      sent_by_email: (await readSessionUser())?.email?.trim().toLowerCase() || null,
    })
    const id = String(row.id)

    if (!created) {
      // 같은 작성 화면에서 온 두 번째 요청이다. 다시 보내지 않는다.
      const status = String(row.status)
      if (status === 'sent') return ApiSuccess.ok({ id, status, duplicate: true, recorded: true })
      if (status === 'sending' || status === 'unknown') {
        throw ApiError.conflict(
          '이미 처리 중이거나 발송 여부를 확인해야 하는 메일입니다. 다시 보내기 전에 보낸 편지함과 Resend 대시보드를 확인해 주세요.'
        )
      }
      throw ApiError.conflict('이전 시도가 실패했습니다. 새로 작성해 주세요.')
    }

    // 일일 상한 — 내 행을 포함해 센다.
    const since = Date.now() - DAY_MS
    const [outboundCount, inboundCount] = await Promise.all([
      countOutboundRecipientsSince(since),
      countInboundSince(since),
    ])
    const verdict = isTestOnly
      ? { allowed: true as const, pressure: false }
      : evaluateQuota(outboundCount, inboundCount, {
          outbound: dailyOutboundLimit(),
          total: dailyTotalGuard(),
        })
    if (verdict.allowed === false) {
      await markOutboundStatus(id, 'blocked', `일일 상한(${verdict.reason})`)
      logSecurityEvent(
        'MAILBOX_COMPOSE_DAILY_LIMIT_REACHED',
        { reason: verdict.reason, outboundCount, inboundCount },
        'high'
      )
      throw ApiError.tooManyRequests(
        '오늘 보낼 수 있는 메일 한도에 도달했습니다. 내일 다시 시도해 주세요.'
      )
    }
    if (verdict.pressure) {
      logSecurityEvent('MAILBOX_OUTBOUND_QUOTA_PRESSURE', { outboundCount, inboundCount }, 'high')
    }

    // 메일이 **안 나간 것이 확실**할 때 올려 둔 첨부(Blob + 행)를 치운다. 안 치우면 실패한 시도마다
    // 비공개 저장소에 아무도 못 보는 파일이 쌓인다. `unknown`(나갔는지 모름)은 치우지 않는다 — 나갔다면
    // 보낸 편지함에서 첨부를 확인할 수 있어야 한다.
    const discardAttachments = async (paths: string[]) => {
      await Promise.allSettled(paths.map(p => deleteObject('private', p)))
      await deleteOutboundAttachmentsForEmail(id).catch(() => undefined)
    }

    // 첨부를 먼저 저장한다 — 여기서 실패해도 아직 아무것도 나가지 않았다.
    const stored: string[] = []
    const toSend: { filename: string; content: Buffer }[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const buffer = Buffer.from(await files[i].arrayBuffer())
        const attachmentId = randomUUID()
        const blobPath = blobPathForSentAttachment(id, attachmentId, attachmentMeta[i].name)
        await putObject(
          'private',
          blobPath,
          buffer,
          files[i].type || 'application/octet-stream',
          false
        )
        stored.push(blobPath)
        await insertOutboundAttachment({
          id: attachmentId,
          email_id: id,
          filename: attachmentMeta[i].name,
          content_type: files[i].type || null,
          size_bytes: buffer.length,
          blob_path: blobPath,
        })
        toSend.push({ filename: attachmentMeta[i].name, content: buffer })
      }
    } catch (error) {
      await discardAttachments(stored)
      await markOutboundStatus(id, 'failed', '첨부 저장 실패').catch(() => undefined)
      logSecurityEvent(
        'ADMIN_MAILBOX_OUTBOUND_API_ERROR',
        {
          stage: 'attachment_store',
          error: error instanceof Error ? error.message : String(error),
        },
        'medium'
      )
      throw ApiError.internalServerError(
        '첨부를 저장하지 못했습니다. 메일은 보내지 않았습니다. 다시 시도해 주세요.'
      )
    }

    // 발송 — 되돌릴 수 없다.
    let resendMessageId: string | null
    try {
      resendMessageId = await sendEmail({
        to: value.to,
        cc: value.cc,
        bcc: value.bcc,
        subject: value.subject,
        html,
        attachments: toSend.length > 0 ? toSend : undefined,
        idempotencyKey,
      })
    } catch (error) {
      const kind = error instanceof MailSendError ? error.kind : 'unknown'
      const message = error instanceof Error ? error.message : String(error)
      if (kind === 'unknown') {
        // 요청이 Resend에 닿았는지 모른다. 실패로 보면 사람이 다시 눌러 중복 발송이 된다.
        await markOutboundStatus(id, 'unknown', message).catch(() => undefined)
        logSecurityEvent('MAILBOX_COMPOSE_SEND_UNKNOWN', { id, error: message }, 'high')
        return ApiSuccess.ok({ id, status: 'unknown', recorded: true })
      }
      await markOutboundStatus(id, 'failed', message).catch(() => undefined)
      await discardAttachments(stored)
      if (kind === 'config') {
        throw ApiError.internalServerError('메일 발송 설정이 올바르지 않습니다.')
      }
      throw ApiError.badGateway('메일 서비스가 발송을 거절했습니다. 잠시 후 다시 시도해 주세요.')
    }

    // 여기서부터는 메일이 이미 나갔다. 기록 실패는 던지지 않는다.
    let recorded = true
    try {
      await markOutboundSent(id, resendMessageId)
    } catch (error) {
      recorded = false
      logSecurityEvent(
        'MAILBOX_COMPOSE_RECORD_FAILED',
        { id, error: error instanceof Error ? error.message : String(error) },
        'high'
      )
    }
    try {
      await logUserActivity({
        user_id: auth.user.id,
        action_type: 'mailbox_email_sent',
        target_type: 'outbound_email',
        target_id: id,
        metadata: {
          recipient_count: value.recipientCount,
          domains: Array.from(
            new Set([...value.to, ...value.cc, ...value.bcc].map(a => a.split('@')[1]))
          ),
          subject_length: value.subject.length,
          attachment_count: toSend.length,
        },
        ip_address:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        user_agent: request.headers.get('user-agent') || null,
      })
    } catch (error) {
      logSecurityEvent(
        'MAILBOX_COMPOSE_AUDIT_FAILED',
        { id, error: error instanceof Error ? error.message : String(error) },
        'high'
      )
    }

    return ApiSuccess.ok({ id, status: 'sent', recorded })
  },
})

// GET: 보낸 편지함 — 새 메일과 답장을 합친 목록(이사·감사·관리자)
export const GET = defineApiRoute<undefined, BoardAuthSuccess>({
  method: 'GET',
  name: 'api/admin/mailbox/outbound',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_mailbox'),
  },
  rateLimitHeaders: true,
  auth: 'board-member',
  errorResponse: () => {
    logSecurityEvent(
      'ADMIN_MAILBOX_OUTBOUND_API_ERROR',
      { error: '서버 오류가 발생했습니다.' },
      'medium'
    )
    return ApiError.internalServerError(
      '보낸 편지함을 불러오는 중 오류가 발생했습니다.'
    ).toNextResponse()
  },
  handler: async ({ request, auth }) => {
    const params = new URL(request.url).searchParams
    const rawKind = params.get('kind')
    const kind: SentMailKind = rawKind === 'compose' || rawKind === 'reply' ? rawKind : 'all'
    const limit = Math.min(Math.max(Number(params.get('limit')) || 30, 1), 100)
    const offset = Math.max(Number(params.get('offset')) || 0, 0)

    const { items, total_count } = await listSentMail({ limit, offset, kind })

    // 한도 현황은 관리자 화면의 작성 모달에만 쓴다.
    let quota: { used: number; limit: number } | null = null
    if (auth.isAdmin) {
      quota = {
        used: await countOutboundRecipientsSince(Date.now() - DAY_MS),
        limit: dailyOutboundLimit(),
      }
    }

    return ApiSuccess.ok({
      items,
      total_count,
      can_manage: auth.isAdmin,
      compose_enabled: isComposeEnabled(),
      quota,
    })
  },
})
