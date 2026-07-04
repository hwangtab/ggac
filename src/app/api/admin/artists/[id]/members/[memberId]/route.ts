export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'

function getRouteParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function parseArtistLegacyId(value: string) {
  const sanitized = value.trim().toLowerCase()
  return /^artist-\d{3,}$/.test(sanitized) ? sanitized : null
}

// DELETE: 아티스트 배정 해제
export const DELETE = defineApiRoute({
  method: 'DELETE',
  name: 'api/admin/artists/[id]/members/[memberId]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_artists_member_action'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () =>
    ApiError.internalServerError('아티스트 배정 해제 중 오류가 발생했습니다.').toNextResponse(),
  handler: async ({ params, auth }) => {
    const { db } = auth

    const artistId = parseArtistLegacyId(getRouteParam(params.id))
    const memberIdValidation = validateUUID(getRouteParam(params.memberId), '멤버 ID')

    // 아티스트 ID 형식 검증 — member_profiles.artist_id는 legacy_id를 보관한다.
    if (!artistId) {
      return ApiError.badRequest('유효하지 않은 아티스트 ID입니다.').toNextResponse()
    }
    if (!memberIdValidation.isValid) {
      return ApiError.badRequest('유효하지 않은 멤버 ID입니다.').toNextResponse()
    }
    const memberId = memberIdValidation.sanitized

    // 대상 멤버 확인
    const { data: targetMember, error: memberError } = await db
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .single()

    if (memberError || !targetMember) {
      return ApiError.notFound('멤버를 찾을 수 없습니다.').toNextResponse()
    }

    // 해당 아티스트에 배정된 멤버인지 확인
    if (targetMember.artist_id !== artistId) {
      return ApiError.badRequest('해당 아티스트에 배정된 멤버가 아닙니다.').toNextResponse()
    }

    // 아티스트 배정 해제
    const { data: updatedMember, error: updateError } = await db
      .from('member_profiles')
      .update({
        artist_id: null,
        artist_role: null,
        is_artist: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return ApiError.internalServerError('아티스트 배정 해제에 실패했습니다.').toNextResponse()
    }

    return ApiSuccess.ok(
      { member: updatedMember },
      `${targetMember.display_name}님의 아티스트 배정이 해제되었습니다.`
    )
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
