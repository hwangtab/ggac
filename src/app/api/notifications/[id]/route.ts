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
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import distributedRateLimiter, { DISTRIBUTED_RATE_LIMIT_CONFIGS, createDistributedUserKeyGenerator } from '@/utils/distributedRateLimiter'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await context.params;
  try {
    // 분산 Rate limiting 적용
    const rateLimiter = await distributedRateLimiter.applyRateLimit({
      ...DISTRIBUTED_RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createDistributedUserKeyGenerator('notification_action')
    })
    
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    
    // 사용자 인증 확인
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // ID 검증
    if (!resolvedParams.id || typeof resolvedParams.id !== 'string' || resolvedParams.id.length > 100) {
      return NextResponse.json({ error: '잘못된 알림 ID입니다.' }, { status: 400 })
    }

    // 알림 읽음 처리
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_notification_id: resolvedParams.id
    })

    if (error) {
      console.error('알림 읽음 처리 오류:', error)
      return NextResponse.json({ error: '알림을 읽음 처리할 수 없습니다.' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: '알림을 찾을 수 없거나 권한이 없습니다.' }, { status: 404 })
    }

    return NextResponse.json({ 
      success: true, 
      message: '알림이 읽음 처리되었습니다.' 
    })

  } catch (error) {
    console.error('알림 읽음 처리 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await context.params;
  try {
    // 분산 Rate limiting 적용
    const rateLimiter = await distributedRateLimiter.applyRateLimit({
      ...DISTRIBUTED_RATE_LIMIT_CONFIGS.GENERAL_API,
      keyGenerator: createDistributedUserKeyGenerator('notification_action')
    })
    
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    
    // 사용자 인증 확인
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // ID 검증
    if (!resolvedParams.id || typeof resolvedParams.id !== 'string' || resolvedParams.id.length > 100) {
      return NextResponse.json({ error: '잘못된 알림 ID입니다.' }, { status: 400 })
    }

    // 알림 삭제 (본인 알림만 삭제 가능)
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', resolvedParams.id)
      .eq('user_id', user.id)

    if (error) {
      console.error('알림 삭제 오류:', error)
      return NextResponse.json({ error: '알림을 삭제할 수 없습니다.' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      message: '알림이 삭제되었습니다.' 
    })

  } catch (error) {
    console.error('알림 삭제 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}