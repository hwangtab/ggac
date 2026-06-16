/**
 * 대량 알림 처리 API
 * POST: 대량 알림 생성 (관리자 전용)
 * PATCH: 모든 알림 읽음 처리
 */

import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { sanitizeNotificationData } from '@/utils/notificationData'
import { parseNotificationExpiresAt } from '@/utils/notificationExpiry'
import { parseNotificationType } from '@/utils/notificationTypes'
import type { CreateBulkNotificationRequest } from '@/types'

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

    // 관리자 권한 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return createErrorResponse({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
    }

    // 요청 본문 파싱 및 검증
    const body = (await parseJsonObjectBody(
      request
    )) as unknown as CreateBulkNotificationRequest | null
    if (!body) {
      return createErrorResponse({ success: false, error: '유효한 JSON body가 필요합니다.' }, 400)
    }

    // 입력 데이터 검증
    if (!Array.isArray(body.user_ids) || body.user_ids.length === 0) {
      return createErrorResponse({ success: false, error: '사용자 ID 배열이 필요합니다.' }, 400)
    }

    const notificationType = parseNotificationType(body.type)
    if (!notificationType) {
      return createErrorResponse({ success: false, error: '알림 유형이 유효하지 않습니다.' }, 400)
    }

    const notificationTitle = typeof body.title === 'string' ? body.title.trim() : ''
    if (!notificationTitle || notificationTitle.length > 200) {
      return createErrorResponse({ success: false, error: '제목이 유효하지 않습니다.' }, 400)
    }

    const notificationMessage = typeof body.message === 'string' ? body.message.trim() : ''
    if (!notificationMessage || notificationMessage.length > 1000) {
      return createErrorResponse({ success: false, error: '메시지가 유효하지 않습니다.' }, 400)
    }

    // 사용자 ID 배열 길이 제한
    if (body.user_ids.length > 1000) {
      return NextResponse.json(
        {
          error: '한 번에 최대 1000명까지만 알림을 보낼 수 있습니다.',
        },
        { status: 400 }
      )
    }

    const userIds: string[] = []
    for (const rawUserId of body.user_ids) {
      const userId = validateBulkUserId(rawUserId)
      if (!userId) {
        return NextResponse.json(
          {
            error: '잘못된 사용자 ID가 포함되어 있습니다.',
          },
          { status: 400 }
        )
      }
      userIds.push(userId)
    }
    const notificationData = sanitizeNotificationData(body.data)
    const expiresAt = parseNotificationExpiresAt(body.expires_at)
    if (expiresAt === undefined) {
      return createErrorResponse({ success: false, error: '만료 시간이 유효하지 않습니다.' }, 400)
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
      return createErrorResponse({ success: false, error: '알림을 생성할 수 없습니다.' }, 500)
    }

    return NextResponse.json({
      success: true,
      created_count: createdCount,
      message: `${createdCount}개의 알림이 성공적으로 생성되었습니다.`,
    })
  } catch (error) {
    console.error('대량 알림 생성 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
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

    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return createErrorResponse({ success: false, error: '인증이 필요합니다.' }, 401)
    }

    // 모든 알림 읽음 처리
    const { data: updatedCount, error } = await supabase.rpc('mark_all_notifications_read')

    if (error) {
      console.error('모든 알림 읽음 처리 오류:', error)
      return createErrorResponse({ success: false, error: '알림을 읽음 처리할 수 없습니다.' }, 500)
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedCount,
      message: `${updatedCount}개의 알림이 읽음 처리되었습니다.`,
    })
  } catch (error) {
    console.error('모든 알림 읽음 처리 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}
