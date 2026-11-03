/**
 * 내 확인 대기(GET) — 내가 확인할 기록과 상대를 기다리는 내 기록 (스펙 §8 확인 대기).
 *
 * `requireTimebankReader`: 꺼져 있어도 읽는다 — 꺼진 동안에도 거절·취소는 할 수
 * 있어야 하므로(§7.2) 무엇이 남았는지 보여야 한다. 세션 회원의 것만 읽는다.
 * 7일 넘은 건은 `stale: true`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, ApiSuccess } from '@/utils/apiWrapper'
import { requireTimebankReader } from '@/lib/server/timebankAuth'
import { listPendingFor } from '@/db/queries/timebankLedger'
import { toMyTransferView } from '@/lib/timebank/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const { to_confirm, awaiting_other } = await listPendingFor(user.id)
      const now = Date.now()
      return ApiSuccess.ok({
        to_confirm: to_confirm.map(r => toMyTransferView(r, user.id, now)),
        awaiting_other: awaiting_other.map(r => toMyTransferView(r, user.id, now)),
      })
    },
    '/api/timebank/me/pending',
    { userId: user.id }
  )
}
