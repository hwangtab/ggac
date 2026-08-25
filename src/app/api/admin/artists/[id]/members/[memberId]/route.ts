export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { getProfileById, updateProfile } from '@/db/queries/profiles'

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
  handler: async ({ params }) => {
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
    let targetMember: Awaited<ReturnType<typeof getProfileById>>
    try {
      targetMember = await getProfileById(memberId)
    } catch (error) {
      console.error('Member fetch error:', error)
      return ApiError.notFound('멤버를 찾을 수 없습니다.').toNextResponse()
    }

    if (!targetMember) {
      return ApiError.notFound('멤버를 찾을 수 없습니다.').toNextResponse()
    }

    // 해당 아티스트에 배정된 멤버인지 확인
    if (targetMember.artist_id !== artistId) {
      return ApiError.badRequest('해당 아티스트에 배정된 멤버가 아닙니다.').toNextResponse()
    }

    // 아티스트 배정 해제
    //
    // `artist_role`은 Postgres 원본에서는 nullable(배정 해제 시 null)이었지만,
    // Turso 스키마(`src/db/schema/identity.ts`)는 `.notNull().default('owner')`로
    // 옮겨졌다 — null을 쓰면 제약 위반으로 던진다. is_artist=false·
    // artist_id=null만으로 "미배정" 상태를 판정하는 모든 소비자
    // (assignedMembers 필터가 is_artist/artist_id 기준, admin/artists/[id]/members
    // POST가 재배정 시 항상 새 role을 명시)에 영향이 없으므로 artist_role은
    // 건드리지 않고 이전 값을 그대로 둔다.
    try {
      await updateProfile(memberId, {
        artist_id: null,
        is_artist: false,
      })
    } catch (error) {
      console.error('Member update error:', error)
      return ApiError.internalServerError('아티스트 배정 해제에 실패했습니다.').toNextResponse()
    }

    const updatedMember = await getProfileById(memberId)

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
