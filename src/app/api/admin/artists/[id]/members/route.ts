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
import { notifyArtistApproved } from '@/lib/server/memberStatusNotify'

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

    // 대상 멤버 확인. 프로필 권위는 Turso다 — Supabase `.eq('id',
    // memberId).eq('registration_status','approved').eq('is_active',
    // true).single()` 대신 getProfileById로 조회한 뒤 같은 세 조건을
    // 코드에서 검사한다(하나라도 어긋나면 이전과 동일하게 "멤버를 찾을 수
    // 없습니다" 404 — 조건별 메시지를 나누지 않는다).
    let targetMember: Awaited<ReturnType<typeof getProfileById>>
    try {
      targetMember = await getProfileById(memberId)
    } catch (error) {
      console.error('Member fetch error:', error)
      return ApiError.notFound('멤버를 찾을 수 없습니다.').toNextResponse()
    }

    if (
      !targetMember ||
      targetMember.registration_status !== 'approved' ||
      !targetMember.is_active
    ) {
      return ApiError.notFound('멤버를 찾을 수 없습니다.').toNextResponse()
    }

    // 이미 다른 아티스트에 배정되어 있는지 확인
    if (targetMember.artist_id && targetMember.artist_id !== artistId) {
      return ApiError.badRequest('이미 다른 아티스트에 배정된 멤버입니다.').toNextResponse()
    }

    // 아티스트 배정 업데이트. artist_role은 위에서 허용 목록(owner/manager/
    // collaborator)으로 이미 검증된 값이 항상 들어가므로 Turso의 NOT NULL
    // 제약과 충돌하지 않는다(해제 라우트와 달리 null을 쓰지 않는다).
    const wasArtist = targetMember.is_artist

    try {
      await updateProfile(memberId, {
        artist_id: artistId,
        artist_role: role as 'owner' | 'manager' | 'collaborator',
        is_artist: true,
      })
    } catch (error) {
      console.error('Member update error:', error)
      return ApiError.internalServerError('아티스트 배정에 실패했습니다.').toNextResponse()
    }

    // is_artist가 false → true로 실제로 바뀐 경우에만 알림을 보낸다(이미
    // 아티스트인 회원이 역할만 바뀌거나 같은 아티스트에 재배정되는 경우는
    // 제외 — 원본 트리거의 `OLD.is_artist = false AND NEW.is_artist = true`
    // 조건). 실패는 로깅만 하고 응답을 막지 않는다(내부에서 이미 흡수).
    if (!wasArtist) {
      await notifyArtistApproved(memberId)
    }

    const updatedMember = await getProfileById(memberId)

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
