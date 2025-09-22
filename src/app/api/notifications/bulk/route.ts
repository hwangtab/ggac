/**
 * 대량 알림 처리 API
 * POST: 대량 알림 생성 (관리자 전용)
 * PATCH: 모든 알림 읽음 처리
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import type { CreateBulkNotificationRequest } from '@/types'

// Rate limiting 설정 (대량 작업은 더 엄격하게)
const bulkRateLimiter = applyRateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  maxRequests: 10, // 시간당 10회만 허용
  keyGenerator: createUserKeyGenerator('bulk_notifications'),
})

const readAllRateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('read_all_notifications'),
})

export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = bulkRateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })

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
    const body: CreateBulkNotificationRequest = await request.json()

    // 입력 데이터 검증
    if (!Array.isArray(body.user_ids) || body.user_ids.length === 0) {
      return NextResponse.json({ error: '사용자 ID 배열이 필요합니다.' }, { status: 400 })
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

    // 사용자 ID 배열 길이 제한
    if (body.user_ids.length > 1000) {
      return NextResponse.json(
        {
          error: '한 번에 최대 1000명까지만 알림을 보낼 수 있습니다.',
        },
        { status: 400 }
      )
    }

    // 각 사용자 ID 검증
    for (const userId of body.user_ids) {
      if (!userId || typeof userId !== 'string' || userId.length > 100) {
        return NextResponse.json(
          {
            error: '잘못된 사용자 ID가 포함되어 있습니다.',
          },
          { status: 400 }
        )
      }
    }

    // 대량 알림 생성
    const { data: createdCount, error } = await supabase.rpc('create_bulk_notification', {
      p_user_ids: body.user_ids,
      p_type: body.type,
      p_title: body.title,
      p_message: body.message,
      p_data: body.data || {},
      p_expires_at: body.expires_at || null,
    })

    if (error) {
      console.error('대량 알림 생성 오류:', error)
      return NextResponse.json({ error: '알림을 생성할 수 없습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      created_count: createdCount,
      message: `${createdCount}개의 알림이 성공적으로 생성되었습니다.`,
    })
  } catch (error) {
    console.error('대량 알림 생성 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = readAllRateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 모든 알림 읽음 처리
    const { data: updatedCount, error } = await supabase.rpc('mark_all_notifications_read')

    if (error) {
      console.error('모든 알림 읽음 처리 오류:', error)
      return NextResponse.json({ error: '알림을 읽음 처리할 수 없습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedCount,
      message: `${updatedCount}개의 알림이 읽음 처리되었습니다.`,
    })
  } catch (error) {
    console.error('모든 알림 읽음 처리 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
