/**
 * 타임뱅크 관리자 라우트(`src/app/api/admin/timebank/**`, 계획 Task 9)의 공통 부품.
 *
 * - 레이트리밋은 라우트마다 `{ ...RATE_LIMITS.ADMIN_API, keyGenerator:
 *   createUserKeyGenerator('admin_timebank_*') }`를 그대로 적는다(정적 가드가 그 모양을 본다).
 * - 원장 오류 → `ApiError`(`describeLedgerError` 표 한 곳에서 문구·상태 코드가 나온다).
 * - 쓰기 기록: 스펙 §7.3 "모든 관리자 쓰기는 `user_activities`와 보안 로그에 남긴다".
 *   활동 기록은 **기다려서** 남긴다(흘려보내면 함수가 얼어붙을 때 기록만 사라진다).
 *   실패하면 보안 로그를 high로 올리고 응답은 그대로 성공이다 — 쓰기는 이미
 *   커밋됐고, 그 사실을 감추는 답이 더 나쁘다(`tickets/reservations/[id]/refund`와 같다).
 */
import type { NextRequest } from 'next/server'

import { logUserActivity, type LogActivityInput } from '@/db/queries/activities'
import { describeLedgerError } from '@/lib/timebank/format'
import type { TimebankSettings } from '@/lib/timebank/settings'
import { ApiError } from '@/utils/apiWrapper'
import { createLogger, maskId } from '@/utils/logger'
import { logSecurityEvent } from '@/utils/security'

const log = createLogger('timebankAdmin')

/**
 * 원장 오류(`TransferRejectedError`·`TransferStateError`)면 표의 문구·상태로 바꾼
 * `ApiError`를, 아니면 받은 오류를 그대로 돌려준다(호출부가 `throw`한다 — 500 처리).
 */
export function toLedgerApiError(error: unknown, settings?: TimebankSettings): unknown {
  const described = describeLedgerError(error, {
    floorMinutes: settings?.min_balance_minutes,
  })
  return described ? new ApiError(described.message, described.status, described.code) : error
}

type AuditInput = {
  request: NextRequest
  actorId: string
  action_type: LogActivityInput['action_type']
  target_type?: LogActivityInput['target_type']
  target_id?: string | null
  metadata: Record<string, unknown>
}

/** 관리자 쓰기 하나를 활동 기록 + 보안 로그로 남긴다. 던지지 않는다. */
export async function auditTimebankAdminWrite(input: AuditInput): Promise<void> {
  const { request } = input
  try {
    await logUserActivity({
      user_id: input.actorId,
      action_type: input.action_type,
      target_type: input.target_type ?? null,
      target_id: input.target_id ?? null,
      metadata: input.metadata,
      ip_address:
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      user_agent: request.headers.get('user-agent') || null,
    })
  } catch (error) {
    logSecurityEvent(
      'TIMEBANK_ADMIN_AUDIT_FAILED',
      {
        action: input.action_type,
        targetId: input.target_id ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
      'high'
    )
    log.error('타임뱅크 관리자 활동 기록 실패', { action: input.action_type })
  }

  logSecurityEvent(
    input.action_type === 'timebank_settings_changed'
      ? 'TIMEBANK_SETTINGS_CHANGED'
      : 'TIMEBANK_ADMIN_WRITE',
    {
      adminId: maskId(input.actorId),
      action: input.action_type,
      targetId: input.target_id ?? null,
      ...input.metadata,
    },
    input.action_type === 'timebank_settings_changed' ? 'high' : 'medium'
  )
}

/** 관리자 타임뱅크 라우트의 500 응답. 내부 오류 문구는 내보내지 않는다. */
export function timebankAdminErrorResponse(name: string, message: string) {
  return (error: unknown) => {
    log.error('타임뱅크 관리자 API 오류', {
      name,
      error: error instanceof Error ? error.message : String(error),
    })
    logSecurityEvent('TIMEBANK_ADMIN_API_ERROR', { name }, 'medium')
    return ApiError.internalServerError(message).toNextResponse()
  }
}
