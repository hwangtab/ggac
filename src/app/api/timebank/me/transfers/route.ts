/**
 * 내 내역(GET) — 채널·KST 월 필터, 페이지 (스펙 §8 내역).
 *
 * - `requireTimebankReader`: 꺼져 있어도 읽는다(§7.2).
 * - **누구의 내역인지는 세션이 정한다.** 쿼리스트링은 `channel`·`month`·`page`만
 *   읽고(`parseMyTransfersQuery`), `member_id` 같은 칸은 보지도 않는다 — 쿼리
 *   계층은 권한을 모르므로 라우트가 세션 id를 넣는다.
 * - 월을 고르면 그 달 확정분의 받은/준 합계(`totals`)를 함께 준다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, ApiSuccess } from '@/utils/apiWrapper'
import { requireTimebankReader } from '@/lib/server/timebankAuth'
import { listTransfersFor, monthlySum } from '@/db/queries/timebankLedger'
import { parseMyTransfersQuery } from '@/lib/timebank/validate'
import { toMyTransferView } from '@/lib/timebank/format'
import { TIMEBANK_KINDS } from '@/constants/timebank'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export async function GET(request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const query = parseMyTransfersQuery(request.nextUrl.searchParams)
      const memberId = user.id
      const { rows, has_next } = await listTransfersFor({
        memberId,
        kinds: query.kinds ?? undefined,
        monthKey: query.month ?? undefined,
        limit: PAGE_SIZE,
        offset: (query.page - 1) * PAGE_SIZE,
      })

      let totals: { received_minutes: number; given_minutes: number } | null = null
      if (query.month) {
        const kinds = query.kinds ?? [...TIMEBANK_KINDS]
        const [received, given] = await Promise.all([
          monthlySum({ account: memberId, kinds, direction: 'in', monthKey: query.month }),
          monthlySum({ account: memberId, kinds, direction: 'out', monthKey: query.month }),
        ])
        totals = { received_minutes: received, given_minutes: given }
      }

      const now = Date.now()
      return ApiSuccess.ok({
        channel: query.channel,
        month: query.month,
        page: query.page,
        has_next,
        totals,
        transfers: rows.map(r => toMyTransferView(r, memberId, now)),
      })
    },
    '/api/timebank/me/transfers',
    { userId: user.id }
  )
}
