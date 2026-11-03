/**
 * 기록할 때 고를 상대 — 현재 판에 동의한 참여자 (스펙 §7.1).
 *
 * **(id, display_name)만** 돌려준다(§15 M "참여자 목록 식별"). 참여 사실과 이름은
 * 참여자끼리만 보인다(이용규칙 제19조) — 그래서 `requireTimebankPeer`(현재 판
 * 동의자만, 꺼져 있어도 읽기는 연다). 자기 자신은 상대가 될 수 없어 뺀다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, ApiSuccess } from '@/utils/apiWrapper'
import { requireTimebankPeer } from '@/lib/server/timebankAuth'
import { listParticipants } from '@/db/queries/timebankProfiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const auth = await requireTimebankPeer()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  return apiGet(
    async () => {
      const rows = await listParticipants(settings.terms_version)
      // 쿼리가 이미 두 칸만 싣지만, 응답 모양을 여기서 한 번 더 못 박는다.
      const participants = rows
        .filter(r => r.id !== user.id)
        .map(r => ({ id: r.id, display_name: r.display_name }))
      return ApiSuccess.ok({ participants })
    },
    '/api/timebank/participants',
    { userId: user.id }
  )
}
