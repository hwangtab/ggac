/**
 * 사용자 좋아요 목록 API
 * GET: 사용자가 좋아요한 게시글 목록 조회
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { countUserLikes, listUserLikes } from '@/db/queries/likes'
import { getProfileAuthzFields } from '@/db/queries/profiles'
import { isApprovedActiveAdmin } from '@/lib/server/authz'
import { RATE_LIMITS, applyRateLimit, createUserKeyGenerator } from '@/lib/server/rateLimit'
import { parseIntegerParam } from '@/utils/queryParams'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'

/**
 * 사용자 좋아요 목록 조회
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    // 분산 Rate limiting 적용
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMITS.GENERAL_API,
      keyGenerator: createUserKeyGenerator('user_likes'),
    })

    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const uuidValidation = validateUUID(resolvedParams.id, '사용자 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(uuidValidation.errors.join(', ')).toNextResponse()
    }
    const requestedUserId = uuidValidation.sanitized
    const { searchParams } = new URL(request.url)
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 1, max: 100 })
    const offset = (page - 1) * limit

    // 본인 데이터이거나 관리자만 조회 가능. 판정에 쓰는 컬럼이 셋뿐이라
    // 프로필 전체(33개 컬럼, 계좌번호·실명 포함)를 실어 오지 않는다.
    if (user.id !== requestedUserId) {
      const profile = await getProfileAuthzFields(user.id)

      if (!isApprovedActiveAdmin(profile)) {
        return ApiError.forbidden('권한이 없습니다.').toNextResponse()
      }
    }

    // 사용자가 좋아요한 게시글 목록 조회 — get_user_likes RPC 대체
    let likedPosts
    try {
      likedPosts = await listUserLikes(requestedUserId, { limit, offset })
    } catch (likesError) {
      console.error('좋아요 목록 조회 오류:', likesError)
      return ApiError.internalServerError('좋아요 목록을 조회할 수 없습니다.').toNextResponse()
    }

    // 총 좋아요 수 조회
    let total: number
    try {
      total = await countUserLikes(requestedUserId)
    } catch (countError) {
      console.error('좋아요 수 조회 오류:', countError)
      return ApiError.internalServerError('좋아요 수를 조회할 수 없습니다.').toNextResponse()
    }

    const totalPages = Math.ceil(total / limit)

    return ApiSuccess.ok({
      liked_posts: likedPosts || [],
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: total,
        per_page: limit,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    }).toNextResponse()
  } catch (error) {
    console.error('사용자 좋아요 목록 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
