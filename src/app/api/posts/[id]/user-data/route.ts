/**
 * 게시글 상세에서 사용자 맞춤 데이터를 가져오는 API
 * 현재는 좋아요 여부만 반환하지만, 추후 확장 가능
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { isPostLikedByUser } from '@/db/queries/likes'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  const validation = validateUUID(postId, '게시글 ID')
  if (!validation.isValid) {
    return ApiError.badRequest(validation.errors[0] || '잘못된 게시글 ID입니다.').toNextResponse()
  }

  // 사용자 맞춤 데이터(내 좋아요 여부) 조회는 로그인만 확인한다.
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const searchParams = new URL(request.url).searchParams
  const userIdFromQuery = searchParams.get('user_id')
  if (userIdFromQuery) {
    const userIdValidation = validateUUID(userIdFromQuery, '사용자 ID')
    if (!userIdValidation.isValid || userIdValidation.sanitized !== user.id) {
      return ApiError.forbidden('FORBIDDEN').toNextResponse()
    }
  }

  try {
    const isLiked = await isPostLikedByUser(validation.sanitized, user.id)
    return ApiSuccess.ok({
      is_liked: isLiked,
    }).toNextResponse()
  } catch (likeError) {
    console.error('[API user-data] like lookup failed:', likeError)
    return ApiError.internalServerError('LIKE_LOOKUP_FAILED').toNextResponse()
  }
}
