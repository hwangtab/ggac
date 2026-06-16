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
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'

const log = createLogger('admin/members/flags')

const MemberFlagsSchema = z
  .object({
    memberId: z.string().uuid('유효하지 않은 멤버 ID입니다.'),
    is_director: z.boolean().optional(),
    director_title: z.string().max(100).nullable().optional(),
    is_auditor: z.boolean().optional(),
  })
  .strict()
  .refine(
    data =>
      data.is_director !== undefined ||
      data.director_title !== undefined ||
      data.is_auditor !== undefined,
    {
      message: 'is_director, director_title, is_auditor 중 하나는 반드시 포함되어야 합니다.',
    }
  )

// API 라우트를 동적으로 렌더링하도록 강제 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PATCH: 회원 이사 플래그/직책 업데이트
export async function PATCH(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_member_flags'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db: adminSupabase, user } = auth

    // 요청 데이터 파싱 및 Zod 검증
    const raw = await parseJsonObjectBody(request)
    if (!raw) {
      return createErrorResponse({ success: false, error: '유효하지 않은 JSON 본문입니다.' }, 400)
    }

    const parsed = MemberFlagsSchema.safeParse(raw)
    if (!parsed.success) {
      logSecurityEvent('INVALID_MEMBER_ACTION', { issues: parsed.error.flatten() }, 'medium')
      return createErrorResponse(
        { success: false, error: '유효하지 않은 요청입니다.', details: parsed.error.flatten() },
        400
      )
    }

    const { is_director, director_title, is_auditor } = parsed.data
    const memberIdValidation = validateUUID(parsed.data.memberId, '멤버 ID')
    if (!memberIdValidation.isValid) {
      return createErrorResponse(
        { success: false, error: memberIdValidation.errors[0] || '유효하지 않은 멤버 ID입니다.' },
        400
      )
    }
    const memberId = memberIdValidation.sanitized

    // 대상 회원 정보 조회
    const { data: targetMember, error: targetError } = await adminSupabase
      .from('member_profiles')
      .select('id, display_name, registration_status, is_admin, is_director')
      .eq('id', memberId)
      .single()

    if (targetError || !targetMember) {
      log.error('Target member fetch error', {
        message: targetError?.message,
        memberId: maskId(memberId),
      })
      return createErrorResponse({ success: false, error: '회원을 찾을 수 없습니다.' }, 404)
    }

    // 업데이트 데이터 구성 (허용된 필드만)
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof is_director === 'boolean') {
      updateData.is_director = is_director
    }

    if (director_title === null || typeof director_title === 'string') {
      updateData.director_title = director_title
    }

    if (typeof is_auditor === 'boolean') {
      updateData.is_auditor = is_auditor
    }

    // 데이터베이스 업데이트
    const { data: updatedMember, error: updateError } = await adminSupabase
      .from('member_profiles')
      .update(updateData)
      .eq('id', memberId)
      .select('id, is_director, director_title, is_auditor, updated_at')
      .single()

    if (updateError) {
      log.error('Member flags update error', {
        message: updateError.message,
        memberId: maskId(memberId),
      })
      return createErrorResponse(
        { success: false, error: '회원 플래그 업데이트에 실패했습니다.' },
        500
      )
    }

    // 보안 이벤트 로깅
    logSecurityEvent(
      'MEMBER_STATUS_CHANGED',
      {
        memberId: maskId(memberId),
        changes: Object.keys(updateData).filter(k => k !== 'updated_at'),
        adminId: maskId(user.id),
      },
      'medium'
    )

    const response = NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님의 권한이 업데이트되었습니다.`,
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
    log.error('Admin member flags API error', error)
    logSecurityEvent(
      'ADMIN_MEMBER_ACTION_ERROR',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'high'
    )
    return createErrorResponse(
      { success: false, error: '회원 권한 변경 중 오류가 발생했습니다.' },
      500
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
