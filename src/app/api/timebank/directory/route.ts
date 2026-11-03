/**
 * 재능 디렉터리 — `visible = true`로 공개한 참여자의 공개 칸만 (스펙 §7.1).
 *
 * 프로필 행 전체를 내보내지 않는다: (id, display_name, offers, needs, categories)만.
 * 참여자끼리 보는 자리라 `requireTimebankPeer`(현재 판 동의자만)다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiGet, ApiSuccess } from '@/utils/apiWrapper'
import { requireTimebankPeer } from '@/lib/server/timebankAuth'
import { listDirectory } from '@/db/queries/timebankProfiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const auth = await requireTimebankPeer()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  return apiGet(
    async () => {
      const rows = await listDirectory(settings.terms_version)
      const directory = rows.map(r => ({
        id: r.id,
        display_name: r.display_name,
        offers: r.offers,
        needs: r.needs,
        categories: r.categories,
      }))
      return ApiSuccess.ok({ directory })
    },
    '/api/timebank/directory',
    { userId: user.id }
  )
}
