/**
 * 못 채운 메일 본문·첨부를 나중에 다시 당긴다 (크론 전용).
 *
 * Task 8의 웹훅은 본문·첨부를 당기다 실패해도 200을 돌려주고
 * `body_fetch_status`를 'pending'으로 남긴다 — 500을 내면 Resend가 재시도하고
 * 그 재시도가 다시 쿼터를 먹기 때문이다. 이 크론이 그 'pending' 행들을 다시
 * 당긴다. 본문은 됐는데 첨부만 실패한 'attachments_failed' 행도 같은
 * 목록(`listPendingInboundEmails`)에 함께 들어온다.
 *
 * Resend는 받은 메일을 30일만 보관한다. 그보다 오래된 행은 다시 당겨봐야
 * Resend에 원본이 없어 소용이 없으므로 최종 포기 표시하고 넘어간다.
 * 'pending'은 `markBodyFetchFailed`로(본문 자체가 없다),
 * 'attachments_failed'는 `markAttachmentsExpired`로(본문은 이미 있다 —
 * 'failed'로 덮으면 그 사실이 사라진다) 서로 다르게 끝맺는다.
 *
 * 30일은 길다. 그 사이에도 매번 실패하는 행이 배치를 독차지하지 않도록, 집은
 * 행에는 `markBodyFetchAttempted`로 시도 시각을 적고 큐를 그 순으로 준다 —
 * 실패한 행은 뒤로 가고 아직 안 집힌 행이 앞에 온다.
 *
 * 인증은 업로드 정리 크론(`/api/internal/uploads/cleanup`)과 같은 방식 — 공유
 * 토큰을 타이밍 안전 비교하고, 토큰이 설정돼 있지 않으면 닫는다
 * (fail-closed). 받는 토큰이 둘인 이유는 `isAuthorized` 주석에 있다.
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  listPendingInboundEmails,
  markBodyFetchAttempted,
  markBodyFetchFailed,
  markAttachmentsExpired,
  markStaleSendingAsUnknown,
  wakeSnoozedEmails,
  listSentWithoutMessageId,
  setOutboundMessageId,
} from '@/db/queries/mailbox'
import { getWorkPeople } from '@/db/queries/work/directory'
import { canAccessBoardRoom } from '@/lib/server/authz'
import { buildSnoozePush } from '@/lib/mail/assigneePush'
import { sendPushToUsers } from '@work/lib/push/send'
import { ingestInboundEmail } from '@/lib/mail/ingestInbound'
import { fetchSentMessageId } from '@/lib/mail/sentMessageId'
import {
  defaultBlobOps,
  sweepAllowedHere,
  sweepConfigFromEnv,
  sweepOutbound,
} from '@/lib/mail/outboundSweep'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'
import { runTrackedCron } from '@work/lib/ops/cron-alert'

const log = createLogger('api/internal/mailbox/backfill')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 배치가 Blob 왕복(본문·첨부)을 여러 번 한다. uploads/cleanup과 같은 이유로 넉넉히 잡아 둔다. */
export const maxDuration = 300

const BATCH_SIZE = 25
/** 한 실행에서 Resend에 물어볼 보낸 메일 수 — 발송 실패분이 쌓여도 크론 시간을 잡아먹지 않게. */
const SENT_MESSAGE_ID_BATCH = 5

/** 이보다 오래 `sending`이면 발송 도중 함수가 죽은 것으로 본다(Resend 30초 + Blob 업로드보다 훨씬 길다). */
const STALE_SENDING_MS = 10 * 60 * 1000

/** Resend Free/Pro/Scale 전 플랜 공통 — 수신 메일 보관 기한이 30일이다. */
const RESEND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function isAuthorized(request: NextRequest): boolean {
  // 받아들이는 토큰 둘.
  //
  // - `MAILBOX_BACKFILL_CRON_TOKEN` — 이 크론 전용 손호출 토큰.
  // - `CRON_SECRET` — **Vercel 크론이 실제로 보내는 값**이다. Vercel은
  //   `Authorization: Bearer $CRON_SECRET`을 고정으로 붙이고 헤더를 바꿀 수단이
  //   없다. 이걸 받지 않으면 vercel.json에 등록한 크론이 매시 401만 받는다.
  //
  // 어느 쪽도 설정돼 있지 않으면 **닫는다**(fail-closed) — 토큰 없는 배포에서
  // 이 라우트가 공개 엔드포인트가 되면 안 된다.
  const expected = [process.env.MAILBOX_BACKFILL_CRON_TOKEN, process.env.CRON_SECRET].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  if (expected.length === 0) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  // 길이 선검사 — timingSafeEqual은 길이가 다르면 던진다.
  return expected.some(
    token =>
      provided.length === token.length && timingSafeEqual(Buffer.from(provided), Buffer.from(token))
  )
}

/** 인증을 통과한 호출만 장부에 남긴다(401은 장부를 오염시키지 않는다 — 스캐너가 두드린 것과 크론 실패는 다르다). */
async function handleBackfill(request: NextRequest) {
  if (!isAuthorized(request)) {
    return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
  }
  return runTrackedCron('mailbox-backfill', request, () => runBackfill(request))
}

async function runBackfill(request: NextRequest) {
  try {
    // 보낸 메일 원장 정리는 본문 백필보다 **먼저** 돈다 — 아래 백필의 조회가 실패해 바깥 catch로 빠져도
    // 이 정리가 건너뛰어지지 않게 하고, 정리 실패가 백필을 막지도 않게 각각 try로 감싼다.
    const housekeepingNow = Date.now()
    // 새 메일 작성의 원장 정리 — 같은 시간 단위 크론에 얹는다(크론 수를 늘리지 않는다).
    // 실패해도 위의 본문 백필 결과를 막지 않는다.
    let staleSending = 0
    try {
      staleSending = await markStaleSendingAsUnknown(housekeepingNow - STALE_SENDING_MS)
    } catch (error) {
      log.error('멈춘 보낸 메일 정리 실패', error)
    }

    // 보낸 메일의 `Message-ID` 채우기 — 발송 직후 Resend에 물어봤지만 실패했거나(네트워크·레이트리밋·그 전 배포)
    // 아직 없는 행. 이 값이 있어야 상대의 답장을 그 메일에 정확히 잇는다(`linkSentReply`). 한 번에 몇 건만 본다.
    let sentMessageIdsFilled = 0
    try {
      for (const row of await listSentWithoutMessageId(SENT_MESSAGE_ID_BATCH)) {
        const messageId = await fetchSentMessageId(row.resend_message_id)
        if (!messageId) continue
        await setOutboundMessageId(row.id, messageId)
        sentMessageIdsFilled += 1
      }
    } catch (error) {
      log.error('보낸 메일 Message-ID 채우기 실패', error)
    }

    // 다시 알림 깨우기 — 시각이 지난 메일을 안 읽음으로 되돌리고 담당자(없으면 건 사람)에게 푸시한다. 받을 사람은
    // 보내는 순간 다시 이사·감사·관리자인지 본다(빠진 사람에게는 보내지 않는다). 실패해도 백필을 막지 않는다.
    let snoozeWoken = 0
    try {
      const woken = await wakeSnoozedEmails(new Date(housekeepingNow))
      snoozeWoken = woken.length
      const recipientIds = [
        ...new Set(woken.map(row => row.assigned_to ?? row.snoozed_by).filter(Boolean) as string[]),
      ]
      const people = await getWorkPeople(recipientIds)
      for (const row of woken) {
        const to = row.assigned_to ?? row.snoozed_by
        const person = to ? people.get(to) : undefined
        if (!to || !person || !canAccessBoardRoom(person)) continue
        await sendPushToUsers([to], buildSnoozePush({ emailId: row.id, subject: row.subject }))
      }
    } catch (error) {
      log.error('다시 알림 깨우기 실패', error)
    }

    // 보낸 메일의 보관 기한·고아 Blob 정리. 마찬가지로 본문 백필 결과를 막지 않는다.
    // 비공개 저장소 토큰이 없으면(로컬·미설정) Blob을 건드릴 수 없으니 건너뛴다.
    let sweep: Awaited<ReturnType<typeof sweepOutbound>> | null = null
    if (sweepAllowedHere() && process.env.PRIVATE_BLOB_READ_WRITE_TOKEN) {
      try {
        sweep = await sweepOutbound(housekeepingNow, sweepConfigFromEnv(), defaultBlobOps())
        if (sweep.orphanSweepAborted) {
          // DB와 Blob 저장소가 서로 다른 환경을 가리키는 신호일 수 있다 — 삭제하지 않고 알린다.
          logSecurityEvent(
            'MAILBOX_OUTBOUND_SWEEP_ABORTED',
            { reason: sweep.orphanSweepAborted },
            'high'
          )
        }
      } catch (error) {
        log.error('보낸 메일 정리 실패', error)
      }
    }

    const pending = await listPendingInboundEmails(BATCH_SIZE)
    const now = Date.now()

    let attempted = 0
    let abandoned = 0

    for (const row of pending) {
      const receivedAt = row.received_at ? new Date(String(row.received_at)).getTime() : NaN
      // `>`(초과)로 비교한다 — 정확히 경계값(딱 30일 지난 행)은 아직 한 번
      // 더 재시도할 기회를 준다. Resend 보관 기한이 근사치라, 그 시점에
      // 원본이 막 사라진 것과 아직 남아 있는 것을 정확히 가를 수 없어서
      // 재시도 한 번을 손해 볼지언정 포기를 서두르지 않는 쪽을 택했다.
      const isExpired = Number.isFinite(receivedAt) && now - receivedAt > RESEND_RETENTION_MS

      if (isExpired) {
        // Resend가 더 이상 원본을 갖고 있지 않다 — 재시도는 무의미하니 최종
        // 포기 표시하고 다음 배치가 이 행을 다시 집지 않게 한다. 어느
        // 쪽으로 포기하는지는 지금까지 뭘 건졌는지에 따라 다르다 — 본문이
        // 이미 있는 행을 'failed'로 덮어 없는 것처럼 보이게 하면 안 된다.
        if (row.body_fetch_status === 'attachments_failed') {
          await markAttachmentsExpired(String(row.id))
        } else {
          await markBodyFetchFailed(String(row.id))
        }
        abandoned += 1
        continue
      }

      // **집었다는 사실을 먼저 적는다.** 이 행은 이번 실행에서 기회를 썼으니
      // 다음 실행에서는 아직 안 집힌 행들 뒤로 간다
      // (`listPendingInboundEmails`의 정렬 근거는 그쪽 주석에 있다). 시도
      // *전에* 적는 이유는, 이 배치가 플랫폼 시간 제한에 끊겨도 앞쪽 행들이
      // 다음 실행의 배치를 똑같이 다시 차지하면 안 되기 때문이다.
      await markBodyFetchAttempted(String(row.id))

      // ingestInboundEmail은 던지지 않는다 — 실패는 상태로 남는다.
      await ingestInboundEmail(String(row.resend_email_id), String(row.id))
      attempted += 1
    }

    // 정상 실행은 아무 로그도 남기지 않아 크론이 돌았는지·무엇을 했는지 볼 길이 없었다. 매 실행 한 줄을 남긴다.
    // `summary`여야 한다 — `info`는 운영에서 지워져 이 줄이 한 번도 남지 않았다(2026-11-05 확인, 2026-11-06 복원).
    log.summary('메일함 크론 요약', {
      pendingBefore: pending.length,
      refetched: attempted,
      abandoned,
      staleSendingMarkedUnknown: staleSending,
      sentMessageIdsFilled,
      snoozeWoken,
      sweep,
    })

    return ApiSuccess.ok({
      pending_before: pending.length,
      stale_sending_marked_unknown: staleSending,
      snooze_woken: snoozeWoken,
      outbound_sweep: sweep,
      // 재시도를 **건 수**다. `ingestInboundEmail`은 실패해도 던지지 않고
      // 상태로만 남기므로, 이 숫자는 성공 건수가 아니다.
      refetched: attempted,
      abandoned,
    }).toNextResponse()
  } catch (error) {
    // 본문을 못 채운 수신 메일을 다시 가져오는 유일한 경로다. 멈춰 있으면
    // Resend 보관 기한(30일)이 지나며 본문이 영영 사라지는데, 크론 실패는
    // 아무에게도 통보되지 않는다.
    log.error('메일함 백필 실패', error)
    try {
      logSecurityEvent(
        'MAILBOX_BACKFILL_CRON_FAILED',
        { error: error instanceof Error ? error.message : String(error) },
        'high'
      )
    } catch {
      // 알림 실패가 응답을 막지 않는다.
    }
    return ApiError.internalServerError('백필에 실패했습니다.').toNextResponse()
  }
}

export async function GET(request: NextRequest) {
  return handleBackfill(request)
}

export async function POST(request: NextRequest) {
  return handleBackfill(request)
}
