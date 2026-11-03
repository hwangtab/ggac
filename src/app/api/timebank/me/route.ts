/**
 * 내 타임 요약(GET) — 마이페이지 첫 카드와 `/mypage/timebank` 잔액 영역 (스펙 §8).
 *
 * - `requireTimebankReader`: 꺼져 있어도 내 잔액은 읽는다(§7.2). 미동의자는 잔액
 *   0과 `terms.needs_agreement = true`를 받는다.
 * - **세션 회원의 것만** 읽는다. 쿼리스트링은 보지 않는다.
 * - 잔액, 하한까지 남은 분, 이번 달(KST) 조합 서비스 사용량(같은 달 환불 차감,
 *   §9.5)/상한, 조합 업무 받은 양/상한, 확인 대기 수, 동의 상태.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, ApiSuccess } from '@/utils/apiWrapper'
import { requireTimebankReader } from '@/lib/server/timebankAuth'
import { balanceOf, listPendingFor, monthlySum } from '@/db/queries/timebankLedger'
import { getTimebankProfile } from '@/db/queries/timebankProfiles'
import { kstMonthKey } from '@/lib/timebank/month'
import { summarizeMe } from '@/lib/timebank/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  return apiGet(
    async () => {
      const month = kstMonthKey(new Date())
      const [balance, serviceUsed, coopTaskReceived, pending, profile] = await Promise.all([
        balanceOf(user.id),
        monthlySum({
          account: user.id,
          kinds: ['redeem'],
          direction: 'out',
          monthKey: month,
          netOfRefunds: true,
        }),
        monthlySum({ account: user.id, kinds: ['coop_task'], direction: 'in', monthKey: month }),
        listPendingFor(user.id),
        getTimebankProfile(user.id),
      ])
      return ApiSuccess.ok(
        summarizeMe({
          settings,
          month,
          balance,
          serviceUsed,
          coopTaskReceived,
          pending: {
            to_confirm: pending.to_confirm.length,
            awaiting_other: pending.awaiting_other.length,
          },
          profile,
        })
      )
    },
    '/api/timebank/me',
    { userId: user.id }
  )
}
