import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { z } from 'zod'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { logSecurityEvent } from '@/utils/security'
import { createLogger, maskId } from '@/utils/logger'
import { validateUUID } from '@/utils/validation'
import { getProfileById, updateProfile } from '@/db/queries/profiles'

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
export const PATCH = defineApiRoute<Record<string, unknown>>({
  method: 'PATCH',
  name: 'api/admin/members/flags',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_member_flags'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효하지 않은 JSON 본문입니다.').toNextResponse(),
  },
  handler: async ({ body, auth }) => {
    try {
      const { user } = auth

      // 요청 데이터 파싱 및 Zod 검증
      const parsed = MemberFlagsSchema.safeParse(body)
      if (!parsed.success) {
        logSecurityEvent('INVALID_MEMBER_ACTION', { issues: parsed.error.flatten() }, 'medium')
        return ApiError.badRequest('유효하지 않은 요청입니다.').toNextResponse()
      }

      const { is_director, director_title, is_auditor } = parsed.data
      const memberIdValidation = validateUUID(parsed.data.memberId, '멤버 ID')
      if (!memberIdValidation.isValid) {
        return ApiError.badRequest(
          memberIdValidation.errors[0] || '유효하지 않은 멤버 ID입니다.'
        ).toNextResponse()
      }
      const memberId = memberIdValidation.sanitized

      // 대상 회원 정보 조회
      let targetMember: Awaited<ReturnType<typeof getProfileById>>
      try {
        targetMember = await getProfileById(memberId)
      } catch (error) {
        log.error('Target member fetch error', {
          message: error instanceof Error ? error.message : String(error),
          memberId: maskId(memberId),
        })
        return ApiError.notFound('회원을 찾을 수 없습니다.').toNextResponse()
      }

      if (!targetMember) {
        log.error('Target member fetch error', {
          message: 'not found',
          memberId: maskId(memberId),
        })
        return ApiError.notFound('회원을 찾을 수 없습니다.').toNextResponse()
      }

      // 업데이트 데이터 구성 (허용된 필드만). updated_at은 쿼리 계층이
      // 자동으로 채운다(넘겨도 무시됨) — 명시적으로 넣지 않는다.
      const updateData: {
        is_director?: boolean
        director_title?: string | null
        is_auditor?: boolean
      } = {}

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
      let updatedProfile: Awaited<ReturnType<typeof getProfileById>>
      try {
        await updateProfile(memberId, updateData)
        updatedProfile = await getProfileById(memberId)
      } catch (error) {
        log.error('Member flags update error', {
          message: error instanceof Error ? error.message : String(error),
          memberId: maskId(memberId),
        })
        return ApiError.internalServerError('회원 플래그 업데이트에 실패했습니다.').toNextResponse()
      }

      // 응답은 이전 select('id, is_director, director_title, is_auditor,
      // updated_at')와 정확히 같은 5개 필드로 좁힌다.
      const updatedMember = updatedProfile && {
        id: updatedProfile.id,
        is_director: updatedProfile.is_director,
        director_title: updatedProfile.director_title,
        is_auditor: updatedProfile.is_auditor,
        updated_at: updatedProfile.updated_at,
      }

      // 보안 이벤트 로깅
      logSecurityEvent(
        'MEMBER_STATUS_CHANGED',
        {
          memberId: maskId(memberId),
          // updateData는 이제 updated_at을 아예 담지 않는다(쿼리 계층이
          // 자동으로 채운다) — 예전엔 여기서 걸러냈지만 지금은 걸러낼 게
          // 없어 그대로 키 목록을 쓴다.
          changes: Object.keys(updateData),
          adminId: maskId(user.id),
        },
        'medium'
      )

      return ApiSuccess.ok(
        { member: updatedMember },
        `${targetMember.display_name}님의 권한이 업데이트되었습니다.`
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
      return ApiError.internalServerError('회원 권한 변경 중 오류가 발생했습니다.').toNextResponse()
    }
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
