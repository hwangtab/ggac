import { createOptionsResponse, createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/server/adminAuth'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'
import { createLogger, maskId } from '@/utils/logger'

const log = createLogger('admin/member-action')

const MemberActionSchema = z
  .object({
    memberId: z.string().uuid('유효하지 않은 멤버 ID입니다.'),
    action: z.enum(['approve', 'reject', 'activate', 'deactivate', 'suspend', 'unsuspend']),
    suspension_reason: z.string().min(1).max(500).optional(),
    suspension_until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다.')
      .optional(),
  })
  .strict()
  .refine(
    data => {
      if (data.action !== 'suspend') return true
      // suspend 액션이 아니면 정지 관련 필드 무시
      return true
    },
    { message: '정지 액션 외에는 정지 관련 필드를 지정할 수 없습니다.' }
  )

type MemberActionInput = z.infer<typeof MemberActionSchema>

// API 라우트를 동적으로 렌더링하도록 강제 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: 회원 액션 처리 (단순한 경로로 우회)
export async function POST(request: NextRequest) {
  let parsedInput: MemberActionInput | null = null

  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_member_action'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db: adminSupabase, user } = auth

    // 요청 데이터 파싱 및 Zod 검증
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return createErrorResponse({ success: false, error: '유효하지 않은 JSON 본문입니다.' }, 400)
    }

    const parsed = MemberActionSchema.safeParse(raw)
    if (!parsed.success) {
      logSecurityEvent('INVALID_MEMBER_ACTION', { issues: parsed.error.flatten() }, 'medium')
      return NextResponse.json(
        { error: '유효하지 않은 요청입니다.', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    parsedInput = parsed.data
    const { memberId, action, suspension_reason, suspension_until } = parsedInput

    // 대상 회원 정보 조회
    const { data: targetMember, error: targetError } = await adminSupabase
      .from('member_profiles')
      .select('id, display_name, registration_status, is_active, is_suspended')
      .eq('id', memberId)
      .single()

    if (targetError || !targetMember) {
      log.error('Target member fetch error', {
        message: targetError?.message,
        memberId: maskId(memberId),
      })
      return createErrorResponse({ success: false, error: '회원을 찾을 수 없습니다.' }, 404)
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
          return createErrorResponse(
            { success: false, error: '승인된 회원만 정지할 수 있습니다.' },
            400
          )
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
      log.error('Member update error', {
        message: updateError.message,
        memberId: maskId(memberId),
        action,
      })
      return createErrorResponse(
        { success: false, error: '회원 상태 업데이트에 실패했습니다.' },
        500
      )
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

    // 보안 이벤트 로깅 — PII(원본 ID/표시명) 평문 노출 회피
    logSecurityEvent(
      'MEMBER_STATUS_CHANGED',
      {
        memberId: maskId(memberId),
        action,
        adminId: maskId(user.id),
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
    log.error('Admin member action API error', error)
    logSecurityEvent(
      'ADMIN_MEMBER_ACTION_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        action: parsedInput?.action,
      },
      'high'
    )
    return createErrorResponse(
      { success: false, error: '회원 상태 변경 중 오류가 발생했습니다.' },
      500
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
