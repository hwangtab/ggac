/**
 * 게시글 상세에서 사용자 맞춤 데이터를 가져오는 API
 * 현재는 좋아요 여부만 반환하지만, 추후 확장 가능
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createSupabaseServer } from '@/lib/supabase/server'
import { validateUUID } from '@/utils/validation'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  const validation = validateUUID(postId, '게시글 ID')
  if (!validation.isValid) {
    return ApiError.badRequest(validation.errors[0] || '잘못된 게시글 ID입니다.').toNextResponse()
  }

  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return ApiError.unauthorized('UNAUTHORIZED').toNextResponse()
  }

  const searchParams = new URL(request.url).searchParams
  const userIdFromQuery = searchParams.get('user_id')
  if (userIdFromQuery) {
    const userIdValidation = validateUUID(userIdFromQuery, '사용자 ID')
    if (!userIdValidation.isValid || userIdValidation.sanitized !== user.id) {
      return ApiError.forbidden('FORBIDDEN').toNextResponse()
    }
  }

  const { data: likeRecord, error: likeError } = await supabase
    .from('post_likes')
    .select('id')
    .eq('post_id', validation.sanitized)
    .eq('user_id', user.id)
    .maybeSingle()

  if (likeError) {
    console.error('[API user-data] like lookup failed:', likeError)
    return ApiError.internalServerError('LIKE_LOOKUP_FAILED').toNextResponse()
  }

  return ApiSuccess.ok({
    is_liked: !!likeRecord,
  }).toNextResponse()
}
