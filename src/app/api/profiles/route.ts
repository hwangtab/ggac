import { NextRequest } from 'next/server'
import { isValidUUID } from '@/utils/validation'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'

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

    // 공개 표시명 조회는 service role로 직접 수행한다(select는 id,display_name으로 제한).
    // 과거에는 SECURITY DEFINER 뷰(public_profiles)로 RLS를 우회했는데, 이는 advisor
    // ERROR 대상이라 뷰를 security_invoker로 전환하고 서버 권한 조회로 대체했다.
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('member_profiles')
      .select('id, display_name')
      .in('id', ids)

    if (error) {
      console.error('[API] 프로필 조회 실패:', error)
      return ApiError.internalServerError(
        '프로필 정보를 불러오는 데 실패했습니다.'
      ).toNextResponse()
    }

    return ApiSuccess.ok(data || []).toNextResponse()
  } catch (e: any) {
    console.error('[API] 프로필 조회 예외 발생:', e)
    return ApiError.internalServerError('요청 처리에 실패했습니다.').toNextResponse()
  }
}
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'
