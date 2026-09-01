/**
 * 내 캘린더. 지원사업은 **내 관심사로 걸러서** 주고, 조합 행사·이사회는 전원 동일하다.
 *
 * 개인 필터를 라우트에서 거는 이유: 쿼리 계층(`src/db/queries/calendar.ts`)은 권한도
 * 선호도 모른다는 이 저장소의 규약 때문이다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { listCalendarItems } from '@/db/queries/calendar'
import { getProfileById } from '@/db/queries/profiles'
import { effectiveInterests, matchesInterests } from '@/lib/server/interestMatch'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return ApiError.badRequest('from·to는 YYYY-MM-DD 형식이어야 합니다.').toNextResponse()
  }
  if (from > to) {
    return ApiError.badRequest('from이 to보다 늦습니다.').toNextResponse()
  }

  const profile = await getProfileById(auth.user.id)
  if (!profile) {
    return ApiError.internalServerError('프로필을 조회할 수 없습니다.').toNextResponse()
  }

  const interests = effectiveInterests(profile)
  const { items: allItems, ongoing: allOngoing } = await listCalendarItems({ from, to })

  const matches = (item: { kind: string; genres?: string[]; regions?: string[] }) =>
    item.kind !== 'grant' ||
    matchesInterests({ genres: item.genres ?? [], regions: item.regions ?? [] }, interests)

  return ApiSuccess.ok({
    items: allItems.filter(matches),
    ongoing: allOngoing.filter(matches),
    interests,
  }).toNextResponse()
}
