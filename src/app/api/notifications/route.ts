/**
 * 알림 목록 조회 및 생성 API
 * GET: 사용자 알림 목록 조회
 * POST: 새 알림 생성 (관리자 전용)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import type { NotificationListResponse, CreateNotificationRequest, Notification } from '@/types'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('notifications'),
})

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
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
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // URL 파라미터 추출 및 검증
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(10, parseInt(searchParams.get('limit') || '20')))
    const type = searchParams.get('type')
    const unread_only = searchParams.get('unread_only') === 'true'

    // 입력 검증
    if (type && (typeof type !== 'string' || type.length > 50)) {
      return NextResponse.json({ error: '잘못된 타입 파라미터입니다.' }, { status: 400 })
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
      return NextResponse.json({ error: '알림을 불러올 수 없습니다.' }, { status: 500 })
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
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용 (더 엄격한 제한)
    const adminRateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('create_notification'),
    })

    const rateLimitResult = adminRateLimiter(request)
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
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 요청 본문 파싱 및 검증
    const body: CreateNotificationRequest = await request.json()

    // 입력 데이터 검증
    if (!body.user_id || typeof body.user_id !== 'string' || body.user_id.length > 100) {
      return NextResponse.json({ error: '사용자 ID가 유효하지 않습니다.' }, { status: 400 })
    }

    if (!body.type || typeof body.type !== 'string' || body.type.length > 50) {
      return NextResponse.json({ error: '알림 유형이 유효하지 않습니다.' }, { status: 400 })
    }

    if (!body.title || typeof body.title !== 'string' || body.title.length > 200) {
      return NextResponse.json({ error: '제목이 유효하지 않습니다.' }, { status: 400 })
    }

    if (!body.message || typeof body.message !== 'string' || body.message.length > 1000) {
      return NextResponse.json({ error: '메시지가 유효하지 않습니다.' }, { status: 400 })
    }

    if (
      body.related_post_id &&
      (typeof body.related_post_id !== 'string' || body.related_post_id.length > 100)
    ) {
      return NextResponse.json({ error: '관련 게시글 ID가 유효하지 않습니다.' }, { status: 400 })
    }

    if (
      body.related_user_id &&
      (typeof body.related_user_id !== 'string' || body.related_user_id.length > 100)
    ) {
      return NextResponse.json({ error: '관련 사용자 ID가 유효하지 않습니다.' }, { status: 400 })
    }

    // 알림 생성
    const { data: notification, error } = await supabase.rpc('create_notification', {
      p_user_id: body.user_id,
      p_type: body.type,
      p_title: body.title,
      p_message: body.message,
      p_data: body.data || {},
      p_related_post_id: body.related_post_id || null,
      p_related_user_id: body.related_user_id || null,
      p_expires_at: body.expires_at || null,
    })

    if (error) {
      console.error('알림 생성 오류:', error)
      return NextResponse.json({ error: '알림을 생성할 수 없습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      notification_id: notification,
      message: '알림이 성공적으로 생성되었습니다.',
    })
  } catch (error) {
    console.error('알림 생성 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
