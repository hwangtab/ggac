/**
 * 알림 목록 조회 및 생성 API
 * GET: 사용자 알림 목록 조회
 * POST: 새 알림 생성 (관리자 전용)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import { sanitizeNotificationData } from '@/utils/notificationData'
import { parseNotificationExpiresAt } from '@/utils/notificationExpiry'
import { parseNotificationType } from '@/utils/notificationTypes'
import type { NotificationListResponse, CreateNotificationRequest, Notification } from '@/types'

function validateNotificationId(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return null
  const validation = validateUUID(value, label)
  return validation.isValid ? validation.sanitized : null
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('notifications'),
    })
    const rateLimitResult = await rateLimiter(request)
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

    // URL 파라미터 추출 및 검증
    const { searchParams } = new URL(request.url)
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 10, max: 50 })
    const typeParam = searchParams.get('type')
    const type = typeParam ? parseNotificationType(typeParam) : null
    const unread_only = searchParams.get('unread_only') === 'true'

    if (typeParam && !type) {
      return createErrorResponse({ success: false, error: '잘못된 타입 파라미터입니다.' }, 400)
    }

    const offset = (page - 1) * limit

    // 기본 쿼리 구성
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    // 필터 적용
    if (type) {
      query = query.eq('type', type)
    }

    if (unread_only) {
      query = query.is('read_at', null)
    }

    // 페이지네이션 적용
    query = query.range(offset, offset + limit - 1)

    const { data: notifications, error, count } = await query

    if (error) {
      console.error('알림 조회 오류:', error)
      return createErrorResponse({ success: false, error: '알림을 불러올 수 없습니다.' }, 500)
    }

    // 미읽은 알림 수 조회
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)

    const response: NotificationListResponse = {
      notifications: notifications as Notification[],
      total: totalCount,
      unread_count: unreadCount || 0,
      pagination: {
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('알림 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용 (더 엄격한 제한)
    const adminRateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('create_notification'),
    })

    const rateLimitResult = await adminRateLimiter(request)
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
    const body = (await parseJsonObjectBody(request)) as unknown as CreateNotificationRequest | null
    if (!body) {
      return createErrorResponse({ success: false, error: '유효한 JSON body가 필요합니다.' }, 400)
    }

    // 입력 데이터 검증
    const userId = validateNotificationId(body.user_id, '사용자 ID')
    if (!userId) {
      return createErrorResponse({ success: false, error: '사용자 ID가 유효하지 않습니다.' }, 400)
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

    const relatedPostId = body.related_post_id
      ? validateNotificationId(body.related_post_id, '관련 게시글 ID')
      : null
    if (body.related_post_id && !relatedPostId) {
      return createErrorResponse(
        { success: false, error: '관련 게시글 ID가 유효하지 않습니다.' },
        400
      )
    }

    const relatedUserId = body.related_user_id
      ? validateNotificationId(body.related_user_id, '관련 사용자 ID')
      : null
    if (body.related_user_id && !relatedUserId) {
      return createErrorResponse(
        { success: false, error: '관련 사용자 ID가 유효하지 않습니다.' },
        400
      )
    }
    const notificationData = sanitizeNotificationData(body.data)
    const expiresAt = parseNotificationExpiresAt(body.expires_at)
    if (expiresAt === undefined) {
      return createErrorResponse({ success: false, error: '만료 시간이 유효하지 않습니다.' }, 400)
    }

    // 알림 생성
    const { data: notification, error } = await supabase.rpc('create_notification', {
      p_user_id: userId,
      p_type: notificationType,
      p_title: notificationTitle,
      p_message: notificationMessage,
      p_data: notificationData,
      p_related_post_id: relatedPostId,
      p_related_user_id: relatedUserId,
      p_expires_at: expiresAt,
    })

    if (error) {
      console.error('알림 생성 오류:', error)
      return createErrorResponse({ success: false, error: '알림을 생성할 수 없습니다.' }, 500)
    }

    return NextResponse.json({
      success: true,
      notification_id: notification,
      message: '알림이 성공적으로 생성되었습니다.',
    })
  } catch (error) {
    console.error('알림 생성 API 오류:', error)
    return createErrorResponse({ success: false, error: '서버 오류가 발생했습니다.' }, 500)
  }
}
