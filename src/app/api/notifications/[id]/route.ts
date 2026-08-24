/**
 * 개별 알림 관리 API
 * PATCH: 알림 읽음 처리
 * DELETE: 알림 삭제
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, applyRateLimit, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'
import { markNotificationRead, deleteNotification } from '@/db/queries/notifications'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    // 분산 Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMITS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('notification_action'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const uuidValidation = validateUUID(resolvedParams.id, '알림 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(uuidValidation.errors.join(', ')).toNextResponse()
    }
    const notificationId = uuidValidation.sanitized

    // 알림 읽음 처리
    // RPC(mark_notification_read)의 auth.uid() 의존을 없애고 세션 사용자 id를
    // 앱 계층(Turso 쿼리 계층)에서 직접 넘긴다. 기존과 동일하게 이미 읽은
    // 알림은 대상에서 제외한다(read_at IS NULL, markNotificationRead 내부).
    let updated: Awaited<ReturnType<typeof markNotificationRead>>
    try {
      updated = await markNotificationRead(notificationId, user.id)
    } catch (error) {
      console.error('알림 읽음 처리 오류:', error)
      return ApiError.internalServerError('알림을 읽음 처리할 수 없습니다.').toNextResponse()
    }

    if (!updated) {
      return ApiError.notFound('알림을 찾을 수 없거나 권한이 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok({}, '알림이 읽음 처리되었습니다.').toNextResponse()
  } catch (error) {
    console.error('알림 읽음 처리 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    // 분산 Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMITS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('notification_action'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const uuidValidation = validateUUID(resolvedParams.id, '알림 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(uuidValidation.errors.join(', ')).toNextResponse()
    }
    const notificationId = uuidValidation.sanitized

    // 알림 삭제 (본인 알림만 삭제 가능)
    try {
      await deleteNotification(notificationId, user.id)
    } catch (error) {
      console.error('알림 삭제 오류:', error)
      return ApiError.internalServerError('알림을 삭제할 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok({}, '알림이 삭제되었습니다.').toNextResponse()
  } catch (error) {
    console.error('알림 삭제 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
