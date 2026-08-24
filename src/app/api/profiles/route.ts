import { NextRequest } from 'next/server'
import { isValidUUID } from '@/utils/validation'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { getProfilesByIds } from '@/db/queries/profiles'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const idsParam = searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      return ApiSuccess.ok([]).toNextResponse()
    }
    if (ids.length > 100) {
      return ApiError.badRequest('Too many ids (max 100)').toNextResponse()
    }

    // UUID 형식 검증 - 유효하지 않은 ID가 하나라도 있으면 400 반환
    const invalidIds = ids.filter(id => !isValidUUID(id))
    if (invalidIds.length > 0) {
      return ApiError.badRequest('유효하지 않은 ID 형식이 포함되어 있습니다.').toNextResponse()
    }

    // 공개 표시명 조회. 프로필 권위는 Turso다 — getProfilesByIds는 쿼리
    // 한 번(inArray)으로 배치 조회하고, 존재하지 않는 id는 그냥 빠진다
    // (에러 아님, 이전 Supabase `.in()`과 동일한 동작).
    let profiles: Map<string, { id: string; display_name: string }>
    try {
      profiles = await getProfilesByIds(ids)
    } catch (error) {
      console.error('[API] 프로필 조회 실패:', error)
      return ApiError.internalServerError(
        '프로필 정보를 불러오는 데 실패했습니다.'
      ).toNextResponse()
    }

    const data = Array.from(profiles.values()).map(profile => ({
      id: profile.id,
      display_name: profile.display_name,
    }))

    return ApiSuccess.ok(data).toNextResponse()
  } catch (e: any) {
    console.error('[API] 프로필 조회 예외 발생:', e)
    return ApiError.internalServerError('요청 처리에 실패했습니다.').toNextResponse()
  }
}
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'
