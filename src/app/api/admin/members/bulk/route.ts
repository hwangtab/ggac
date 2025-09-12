import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import type { BulkOperationRequest } from '@/types'
import { validateFormData } from '@/utils/validation'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST: 대량 멤버 작업 수행
export async function POST(request: NextRequest) {
  try {
    // Rate limiting 적용 (대량 작업은 엄격하게 제한)
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.BULK_OPERATIONS,
      keyGenerator: createUserKeyGenerator('bulk_operations'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 서비스 롤 클라이언트(있으면 RLS 우회)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const db =
      url && serviceKey
        ? createClient(url, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : supabase

    // 요청 데이터 파싱 및 검증
    const requestData = await request.json()
    const { operation_type, member_ids, parameters = {} }: BulkOperationRequest = requestData

    // 기본 데이터 검증
    if (!operation_type || !member_ids || !Array.isArray(member_ids) || member_ids.length === 0) {
      return NextResponse.json({ error: '유효하지 않은 요청 데이터입니다.' }, { status: 400 })
    }

    // 대량 작업 수량 제한
    if (member_ids.length > 100) {
      return NextResponse.json(
        { error: '한 번에 최대 100명까지만 처리할 수 있습니다.' },
        { status: 400 }
      )
    }

    // 멤버 ID 검증 (UUID 형식)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const invalidIds = member_ids.filter(id => !uuidPattern.test(id))
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: '유효하지 않은 멤버 ID가 포함되어 있습니다.' },
        { status: 400 }
      )
    }

    // 작업 타입 검증
    const allowedOperations = [
      'bulk_approve',
      'bulk_reject',
      'bulk_activate',
      'bulk_deactivate',
      'bulk_suspend',
    ]
    if (!allowedOperations.includes(operation_type)) {
      logSecurityEvent('INVALID_BULK_OPERATION', { operation_type, member_ids }, 'high')
      return NextResponse.json({ error: '유효하지 않은 작업 타입입니다.' }, { status: 400 })
    }

    // 정지 관련 데이터 검증
    if (operation_type === 'bulk_suspend') {
      if (parameters.suspension_reason) {
        const reasonValidation = validateFormData(
          { suspension_reason: parameters.suspension_reason },
          { suspension_reason: 'content' }
        )
        if (!reasonValidation.isValid) {
          return NextResponse.json({ error: '유효하지 않은 정지 사유입니다.' }, { status: 400 })
        }
      }

      if (parameters.suspension_until) {
        const datePattern = /^\d{4}-\d{2}-\d{2}$/
        if (!datePattern.test(parameters.suspension_until)) {
          return NextResponse.json({ error: '유효하지 않은 날짜 형식입니다.' }, { status: 400 })
        }
      }
    }

    // 대량 작업 로그 생성
    const { data: bulkOperation, error: bulkError } = await db
      .from('member_bulk_operations')
      .insert({
        operation_type,
        performed_by: session.user.id,
        member_ids,
        parameters,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (bulkError) {
      console.error('Bulk operation log error:', bulkError)
      return NextResponse.json({ error: '대량 작업 로그 생성에 실패했습니다.' }, { status: 500 })
    }

    // 작업 시작 표시
    await db
      .from('member_bulk_operations')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', bulkOperation.id)

    let successCount = 0
    let errorCount = 0
    const results: any[] = []

    try {
      // 각 멤버에 대해 작업 수행
      for (const memberId of member_ids) {
        try {
          // 멤버 정보 조회
          const { data: targetMember, error: targetError } = await db
            .from('member_profiles')
            .select('id, display_name, registration_status, is_active, is_suspended')
            .eq('id', memberId)
            .single()

          if (targetError || !targetMember) {
            errorCount++
            results.push({
              member_id: memberId,
              success: false,
              error: '회원을 찾을 수 없습니다.',
            })
            continue
          }

          // 작업 타입에 따른 업데이트 데이터 준비
          let updateData: any = {}
          let canPerform = true
          let errorMessage = ''

          switch (operation_type) {
            case 'bulk_approve':
              if (targetMember.registration_status !== 'pending') {
                canPerform = false
                errorMessage = '승인 대기 상태의 회원만 승인할 수 있습니다.'
              } else {
                updateData = {
                  registration_status: 'approved',
                  is_active: true,
                  approved_by: session.user.id,
                  approved_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              }
              break

            case 'bulk_reject':
              if (targetMember.registration_status !== 'pending') {
                canPerform = false
                errorMessage = '승인 대기 상태의 회원만 거부할 수 있습니다.'
              } else {
                updateData = {
                  registration_status: 'rejected',
                  is_active: false,
                  rejected_by: session.user.id,
                  updated_at: new Date().toISOString(),
                }
              }
              break

            case 'bulk_activate':
              if (targetMember.registration_status !== 'approved') {
                canPerform = false
                errorMessage = '승인된 회원만 활성화할 수 있습니다.'
              } else {
                updateData = {
                  is_active: true,
                  is_suspended: false,
                  suspension_reason: null,
                  suspension_until: null,
                  updated_at: new Date().toISOString(),
                }
              }
              break

            case 'bulk_deactivate':
              if (targetMember.registration_status !== 'approved') {
                canPerform = false
                errorMessage = '승인된 회원만 비활성화할 수 있습니다.'
              } else {
                updateData = {
                  is_active: false,
                  updated_at: new Date().toISOString(),
                }
              }
              break

            case 'bulk_suspend':
              if (targetMember.registration_status !== 'approved') {
                canPerform = false
                errorMessage = '승인된 회원만 정지할 수 있습니다.'
              } else {
                updateData = {
                  is_suspended: true,
                  is_active: false,
                  suspension_reason: parameters.suspension_reason || '관리자에 의한 대량 정지',
                  suspension_until: parameters.suspension_until || null,
                  updated_at: new Date().toISOString(),
                }
              }
              break
          }

          if (!canPerform) {
            errorCount++
            results.push({
              member_id: memberId,
              member_name: targetMember.display_name,
              success: false,
              error: errorMessage,
            })
            continue
          }

          // 업데이트 수행
          const { error: updateError } = await db
            .from('member_profiles')
            .update(updateData)
            .eq('id', memberId)

          if (updateError) {
            errorCount++
            results.push({
              member_id: memberId,
              member_name: targetMember.display_name,
              success: false,
              error: '데이터베이스 업데이트에 실패했습니다.',
            })
          } else {
            successCount++
            results.push({
              member_id: memberId,
              member_name: targetMember.display_name,
              success: true,
            })
          }
        } catch (memberError) {
          errorCount++
          results.push({
            member_id: memberId,
            success: false,
            error: '처리 중 오류가 발생했습니다.',
          })
        }
      }

      // 작업 완료 표시
      await db
        .from('member_bulk_operations')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          results: {
            success_count: successCount,
            error_count: errorCount,
            details: results,
          },
        })
        .eq('id', bulkOperation.id)

      // 보안 이벤트 로깅
      logSecurityEvent(
        'BULK_OPERATION_COMPLETED',
        {
          operation_id: bulkOperation.id,
          operation_type,
          member_count: member_ids.length,
          success_count: successCount,
          error_count: errorCount,
          admin_id: session.user.id,
        },
        'medium'
      )

      const response = NextResponse.json({
        success: true,
        operation_id: bulkOperation.id,
        summary: {
          total: member_ids.length,
          success: successCount,
          errors: errorCount,
        },
        results,
      })

      // Rate limit 헤더 추가
      return addRateLimitHeaders(
        response,
        RATE_LIMIT_CONFIGS.BULK_OPERATIONS.maxRequests,
        rateLimitResult.remaining,
        rateLimitResult.resetTime
      )
    } catch (operationError) {
      console.error('Bulk operation error:', operationError)

      // 작업 실패 표시
      await db
        .from('member_bulk_operations')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message:
            operationError instanceof Error ? operationError.message : '알 수 없는 오류',
          results: {
            success_count: successCount,
            error_count: errorCount,
            details: results,
          },
        })
        .eq('id', bulkOperation.id)

      return NextResponse.json({ error: '대량 작업 처리 중 오류가 발생했습니다.' }, { status: 500 })
    }
  } catch (error) {
    console.error('Bulk members API error:', error)
    logSecurityEvent(
      'BULK_OPERATION_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'high'
    )
    return NextResponse.json({ error: '대량 작업 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

// GET: 대량 작업 상태 조회
export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (
      profileError ||
      !profile.is_admin ||
      profile.registration_status !== 'approved' ||
      !profile.is_active
    ) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 대량 작업 이력 조회
    const { data: operations, error: operationsError } = await supabase
      .from('member_bulk_operations')
      .select(
        `
        id,
        operation_type,
        member_ids,
        parameters,
        results,
        status,
        created_at,
        started_at,
        completed_at,
        error_message,
        performed_by_member:member_profiles!performed_by (
          display_name,
          email
        )
      `
      )
      .order('created_at', { ascending: false })
      .limit(50)

    if (operationsError) {
      console.error('Operations fetch error:', operationsError)
      return NextResponse.json({ error: '대량 작업 이력을 조회할 수 없습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      operations: operations || [],
    })
  } catch (error) {
    console.error('Bulk operations list API error:', error)
    return NextResponse.json(
      { error: '대량 작업 이력을 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
