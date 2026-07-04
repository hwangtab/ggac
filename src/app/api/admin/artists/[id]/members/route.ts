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

// POST: 아티스트에 멤버 배정
export const POST = defineApiRoute<Record<string, unknown>>({
  method: 'POST',
  name: 'api/admin/artists/[id]/members',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_artists_id_members'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: () =>
    ApiError.internalServerError('아티스트 배정 중 오류가 발생했습니다.').toNextResponse(),
  handler: async ({ params, body, auth }) => {
    const { db } = auth

    // 요청 데이터 파싱
    const rawMemberId = typeof body.memberId === 'string' ? body.memberId : ''
    const role = typeof body.role === 'string' ? body.role : ''
    const artistId = parseArtistLegacyId(getRouteParam(params.id))

    // 아티스트 ID 형식 검증 — member_profiles.artist_id는 legacy_id(예: 'artist-015')를 보관한다.
    if (!artistId) {
      return ApiError.badRequest('유효하지 않은 아티스트 ID입니다.').toNextResponse()
    }
    const memberIdValidation = validateUUID(rawMemberId, '멤버 ID')
    if (!memberIdValidation.isValid) {
      return ApiError.badRequest('유효하지 않은 멤버 ID입니다.').toNextResponse()
    }
    const memberId = memberIdValidation.sanitized

    // 아티스트 존재 확인
    const { data: artistExists, error: artistLookupError } = await db
      .from('artists')
      .select('legacy_id')
      .eq('legacy_id', artistId)
      .maybeSingle()
    if (artistLookupError || !artistExists) {
      return ApiError.notFound('아티스트를 찾을 수 없습니다.').toNextResponse()
    }

    if (!role) {
      return ApiError.badRequest('역할이 필요합니다.').toNextResponse()
    }

    if (!['owner', 'manager', 'collaborator'].includes(role)) {
      return ApiError.badRequest('유효하지 않은 역할입니다.').toNextResponse()
    }

    // 대상 멤버 확인
    const { data: targetMember, error: memberError } = await db
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .eq('registration_status', 'approved')
      .eq('is_active', true)
      .single()

    if (memberError || !targetMember) {
      return ApiError.notFound('멤버를 찾을 수 없습니다.').toNextResponse()
    }

    // 이미 다른 아티스트에 배정되어 있는지 확인
    if (targetMember.artist_id && targetMember.artist_id !== artistId) {
      return ApiError.badRequest('이미 다른 아티스트에 배정된 멤버입니다.').toNextResponse()
    }

    // 아티스트 배정 업데이트
    const { data: updatedMember, error: updateError } = await db
      .from('member_profiles')
      .update({
        artist_id: artistId,
        artist_role: role,
        is_artist: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return ApiError.internalServerError('아티스트 배정에 실패했습니다.').toNextResponse()
    }

    return ApiSuccess.ok(
      { member: updatedMember },
      `${targetMember.display_name}님이 아티스트로 배정되었습니다.`
    )
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
