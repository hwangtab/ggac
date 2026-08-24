/**
 * 대량 알림 처리 API
 * POST: 대량 알림 생성 (관리자 전용)
 * PATCH: 모든 알림 읽음 처리
 */

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'
import { sanitizeNotificationData } from '@/utils/notificationData'
import { parseNotificationExpiresAt } from '@/utils/notificationExpiry'
import { parseNotificationType } from '@/utils/notificationTypes'
import { markAllNotificationsRead } from '@/lib/server/notificationsWrite'
import type { CreateBulkNotificationRequest } from '@/types'
import { getProfileById } from '@/db/queries/profiles'

function validateBulkUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const validation = validateUUID(value, '사용자 ID')
  return validation.isValid ? validation.sanitized : null
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용 (대량 작업은 더 엄격하게)
    const bulkRateLimiter = await applyRateLimit({
      windowMs: 60 * 60 * 1000, // 1시간
      maxRequests: 10, // 시간당 10회만 허용
      keyGenerator: createUserKeyGenerator('bulk_notifications'),
    })
    const rateLimitResult = await bulkRateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 관리자 권한 확인. 조회 자체가 실패해도(연결 오류 등) 이전 Supabase
    // 쿼리가 error를 검사하지 않고 `!profile`로만 판정하던 것과 동일하게
    // fail-closed 403으로 수렴시킨다(500으로 승격하지 않음).
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch {
      profile = null
    }

    if (!profile?.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return ApiError.forbidden('관리자 권한이 필요합니다.').toNextResponse()
    }

    // 요청 본문 파싱 및 검증
    const body = (await parseJsonObjectBody(
      request
    )) as unknown as CreateBulkNotificationRequest | null
    if (!body) {
      return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    }

    // 입력 데이터 검증
    if (!Array.isArray(body.user_ids) || body.user_ids.length === 0) {
      return ApiError.badRequest('사용자 ID 배열이 필요합니다.').toNextResponse()
    }

    const notificationType = parseNotificationType(body.type)
    if (!notificationType) {
      return ApiError.badRequest('알림 유형이 유효하지 않습니다.').toNextResponse()
    }

    const notificationTitle = typeof body.title === 'string' ? body.title.trim() : ''
    if (!notificationTitle || notificationTitle.length > 200) {
      return ApiError.badRequest('제목이 유효하지 않습니다.').toNextResponse()
    }

    const notificationMessage = typeof body.message === 'string' ? body.message.trim() : ''
    if (!notificationMessage || notificationMessage.length > 1000) {
      return ApiError.badRequest('메시지가 유효하지 않습니다.').toNextResponse()
    }

    // 사용자 ID 배열 길이 제한
    if (body.user_ids.length > 1000) {
      return ApiError.badRequest(
        '한 번에 최대 1000명까지만 알림을 보낼 수 있습니다.'
      ).toNextResponse()
    }

    const userIds: string[] = []
    for (const rawUserId of body.user_ids) {
      const userId = validateBulkUserId(rawUserId)
      if (!userId) {
        return ApiError.badRequest('잘못된 사용자 ID가 포함되어 있습니다.').toNextResponse()
      }
      userIds.push(userId)
    }
    const notificationData = sanitizeNotificationData(body.data)
    const expiresAt = parseNotificationExpiresAt(body.expires_at)
    if (expiresAt === undefined) {
      return ApiError.badRequest('만료 시간이 유효하지 않습니다.').toNextResponse()
    }

    // 대량 알림 생성
    const { data: createdCount, error } = await supabase.rpc('create_bulk_notification', {
      p_user_ids: userIds,
      p_type: notificationType,
      p_title: notificationTitle,
      p_message: notificationMessage,
      p_data: notificationData,
      p_expires_at: expiresAt,
    })

    if (error) {
      console.error('대량 알림 생성 오류:', error)
      return ApiError.internalServerError('알림을 생성할 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok(
      { created_count: createdCount },
      `${createdCount}개의 알림이 성공적으로 생성되었습니다.`
    ).toNextResponse()
  } catch (error) {
    console.error('대량 알림 생성 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Rate limiting 적용
    const readAllRateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('read_all_notifications'),
    })
    const rateLimitResult = await readAllRateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    // 사용자 인증 확인
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const supabase = await createSupabaseServer()

    // 모든 알림 읽음 처리
    //
    // 원래는 mark_all_notifications_read() RPC였다. 그 함수는
    // `WHERE user_id = auth.uid()` 하나로만 대상을 골랐는데, 서비스롤 클라이언트
    // 전환 이후 auth.uid()가 항상 NULL이라 늘 0건을 갱신하고 성공으로 응답했다
    // (운영 재현 완료). 세션에서 확인한 user.id를 직접 조건으로 쓴다.
    let updatedCount: number
    try {
      const { updatedIds } = await markAllNotificationsRead(supabase, user.id)
      updatedCount = updatedIds.length
    } catch (error) {
      console.error('모든 알림 읽음 처리 오류:', error)
      return ApiError.internalServerError('알림을 읽음 처리할 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok(
      { updated_count: updatedCount },
      `${updatedCount}개의 알림이 읽음 처리되었습니다.`
    ).toNextResponse()
  } catch (error) {
    console.error('모든 알림 읽음 처리 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
