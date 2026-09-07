/**
 * 못 채운 메일 본문·첨부를 나중에 다시 당긴다 (크론 전용).
 *
 * Task 8의 웹훅은 본문·첨부를 당기다 실패해도 200을 돌려주고
 * `body_fetch_status`를 'pending'으로 남긴다 — 500을 내면 Resend가 재시도하고
 * 그 재시도가 다시 쿼터를 먹기 때문이다. 이 크론이 그 'pending' 행들을 다시
 * 당긴다.
 *
 * Resend는 받은 메일을 30일만 보관한다. 그보다 오래된 pending 행은 다시
 * 당겨봐야 Resend에 원본이 없어 소용이 없으므로 `markBodyFetchFailed`로 최종
 * 포기 표시하고 넘어간다 — 그래야 영구 실패 행이 매 실행 배치를 계속
 * 차지하지 않는다.
 *
 * 인증은 업로드 정리 크론(`/api/internal/uploads/cleanup`)과 같은 방식 — 공유
 * 토큰을 타이밍 안전 비교하고, 토큰이 설정돼 있지 않으면 닫는다
 * (fail-closed). 받는 토큰이 둘인 이유는 `isAuthorized` 주석에 있다.
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { listPendingInboundEmails, markBodyFetchFailed } from '@/db/queries/mailbox'
import { ingestInboundEmail } from '@/lib/mail/ingestInbound'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/mailbox/backfill')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 배치가 Blob 왕복(본문·첨부)을 여러 번 한다. uploads/cleanup과 같은 이유로 넉넉히 잡아 둔다. */
export const maxDuration = 300

const BATCH_SIZE = 25

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

async function handleBackfill(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    const pending = await listPendingInboundEmails(BATCH_SIZE)
    const now = Date.now()

    let filled = 0
    let abandoned = 0

    for (const row of pending) {
      const receivedAt = row.received_at ? new Date(String(row.received_at)).getTime() : NaN
      const isExpired = Number.isFinite(receivedAt) && now - receivedAt > RESEND_RETENTION_MS

      if (isExpired) {
        // Resend가 더 이상 원본을 갖고 있지 않다 — 재시도는 무의미하니 최종
        // 포기 표시하고 다음 배치가 이 행을 다시 집지 않게 한다.
        await markBodyFetchFailed(String(row.id))
        abandoned += 1
        continue
      }

      // ingestInboundEmail은 던지지 않는다 — 실패는 상태로 남는다.
      await ingestInboundEmail(String(row.resend_email_id), String(row.id))
      filled += 1
    }

    return ApiSuccess.ok({
      pending_before: pending.length,
      refetched: filled,
      abandoned,
    }).toNextResponse()
  } catch (error) {
    log.error('메일함 백필 실패', error)
    return ApiError.internalServerError('백필에 실패했습니다.').toNextResponse()
  }
}

export async function GET(request: NextRequest) {
  return handleBackfill(request)
}

export async function POST(request: NextRequest) {
  return handleBackfill(request)
}
