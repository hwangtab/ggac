/**
 * 조합원 공개 집계(GET `?month=YYYY-MM`) (스펙 §7.1·§12).
 *
 * - `requireTimebankReader`: 승인·활성 조합원이면 꺼져 있어도 본다.
 * - **개인 식별자가 없다.** 건수·분·비율과 사람 수 구간만 싣고, 사람 수 구간이
 *   3명 미만이면 null(화면은 "3명 미만")이다 — `publicStats`가 응답 직전에 한 번
 *   더 가린다.
 * - 월이 없거나 틀리면 이번 달(KST).
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, ApiSuccess } from '@/utils/apiWrapper'
import { requireTimebankReader } from '@/lib/server/timebankAuth'
import { participationStats } from '@/db/queries/timebankLedger'
import { parseMonthParam } from '@/lib/timebank/validate'
import { kstMonthKey } from '@/lib/timebank/month'
import { publicStats } from '@/lib/timebank/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  return apiGet(
    async () => {
      const month =
        parseMonthParam(request.nextUrl.searchParams.get('month')) ?? kstMonthKey(new Date())
      const stats = await participationStats(month, settings)
      return ApiSuccess.ok(publicStats(stats))
    },
    '/api/timebank/stats',
    { userId: user.id }
  )
}
