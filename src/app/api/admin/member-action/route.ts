import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { validateFormData } from '@/utils/validation'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

// API 라우트를 동적으로 렌더링하도록 강제 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: 회원 액션 처리 (단순한 경로로 우회)
export async function POST(request: NextRequest) {
  let requestData: any = {} // catch 블록에서 접근 가능하도록 함수 최상단에 선언

  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_member_action'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
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

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('[member-action] Profile fetch error:', profileError)
      return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 관리자 작업용 서비스 롤 클라이언트 생성
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[member-action] SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.')
      return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
    }
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    // 요청 데이터 파싱 및 검증
    requestData = await request.json()
    const { memberId, action, suspension_reason, suspension_until } = requestData

    // 멤버 ID 검증 (UUID 형식)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!memberId || !uuidPattern.test(memberId)) {
      return NextResponse.json({ error: '유효하지 않은 멤버 ID입니다.' }, { status: 400 })
    }

    // 액션 검증
    const allowedActions = ['approve', 'reject', 'activate', 'deactivate', 'suspend', 'unsuspend']

    if (!action || !allowedActions.includes(action)) {
      logSecurityEvent('INVALID_MEMBER_ACTION', { action, memberId }, 'medium')
      return NextResponse.json({ error: '유효하지 않은 액션입니다.' }, { status: 400 })
    }

    // 정지 관련 데이터 검증
    if (action === 'suspend') {
      if (suspension_reason) {
        const reasonValidation = validateFormData(
          { suspension_reason },
          { suspension_reason: 'content' }
        )
        if (!reasonValidation.isValid) {
          return NextResponse.json({ error: '유효하지 않은 정지 사유입니다.' }, { status: 400 })
        }
      }

      if (suspension_until) {
        const datePattern = /^\d{4}-\d{2}-\d{2}$/
        if (!datePattern.test(suspension_until)) {
          return NextResponse.json({ error: '유효하지 않은 날짜 형식입니다.' }, { status: 400 })
        }
      }
    }

    // 대상 회원 정보 조회
    const { data: targetMember, error: targetError } = await adminSupabase
      .from('member_profiles')
      .select('id, display_name, registration_status, is_active, is_suspended')
      .eq('id', memberId)
      .single()

    if (targetError || !targetMember) {
      console.error('[member-action] Target member fetch error:', targetError?.message)
      return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 액션에 따른 업데이트 데이터 준비
    let updateData: any = {}

    switch (action) {
      case 'approve':
        if (targetMember.registration_status !== 'pending') {
          return NextResponse.json(
            { error: '승인 대기 상태의 회원만 승인할 수 있습니다.' },
            { status: 400 }
          )
        }
        updateData = {
          registration_status: 'approved',
          is_active: true,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        break

      case 'reject':
        if (targetMember.registration_status !== 'pending') {
          return NextResponse.json(
            { error: '승인 대기 상태의 회원만 거부할 수 있습니다.' },
            { status: 400 }
          )
        }
        updateData = {
          registration_status: 'rejected',
          is_active: false,
          rejected_by: user.id,
          updated_at: new Date().toISOString(),
        }
        break

      case 'activate':
        if (targetMember.registration_status !== 'approved') {
          return NextResponse.json(
            { error: '승인된 회원만 활성화할 수 있습니다.' },
            { status: 400 }
          )
        }
        updateData = {
          is_active: true,
          updated_at: new Date().toISOString(),
        }
        break

      case 'deactivate':
        if (targetMember.registration_status !== 'approved') {
          return NextResponse.json(
            { error: '승인된 회원만 비활성화할 수 있습니다.' },
            { status: 400 }
          )
        }
        updateData = {
          is_active: false,
          updated_at: new Date().toISOString(),
        }
        break

      case 'suspend':
        if (targetMember.registration_status !== 'approved') {
          return NextResponse.json({ error: '승인된 회원만 정지할 수 있습니다.' }, { status: 400 })
        }
        updateData = {
          is_suspended: true,
          is_active: false,
          suspension_reason: suspension_reason || '관리자에 의한 정지',
          suspension_until: suspension_until || null,
          updated_at: new Date().toISOString(),
        }
        break

      case 'unsuspend':
        if (!targetMember.is_suspended) {
          return NextResponse.json(
            { error: '정지된 회원만 정지해제할 수 있습니다.' },
            { status: 400 }
          )
        }
        updateData = {
          is_suspended: false,
          is_active: true,
          suspension_reason: null,
          suspension_until: null,
          updated_at: new Date().toISOString(),
        }
        break
    }

    // 데이터베이스 업데이트
    const { data: updatedMember, error: updateError } = await adminSupabase
      .from('member_profiles')
      .update(updateData)
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('[member-action] Member update error:', updateError.message)
      return NextResponse.json({ error: '회원 상태 업데이트에 실패했습니다.' }, { status: 500 })
    }

    // 성공 응답
    const actionMessages: Record<string, string> = {
      approve: '승인',
      reject: '거부',
      activate: '활성화',
      deactivate: '비활성화',
      suspend: '정지',
      unsuspend: '정지해제',
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'MEMBER_STATUS_CHANGED',
      {
        memberId,
        action,
        targetMember: targetMember.display_name,
        adminId: user.id,
      },
      'medium'
    )

    const response = NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님이 ${actionMessages[action]}되었습니다.`,
      member: updatedMember,
    })

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('[member-action] Admin member action API error:', error)
    logSecurityEvent(
      'ADMIN_MEMBER_ACTION_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestBody: JSON.stringify(requestData),
      },
      'high'
    )
    return NextResponse.json({ error: '회원 상태 변경 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
