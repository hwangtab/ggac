import { NextResponse } from 'next/server'
import { isMemberDocumentsEnabled } from '@/lib/memberDocuments/settings'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/mypage/documents/status — 마이페이지 메뉴가 '내 문서함'을 보일지 묻는다(docs/board-work/04-조합원-문서함.md §7).
 * 스위치가 꺼져 있어도 200 `{ enabled: false }`다(이 응답이 곧 스위치 상태). 게이트는 다른 문서함 라우트와 같다 —
 * 비회원에게는 스위치 상태도 알리지 않는다.
 */
export async function GET() {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  return ApiSuccess.ok({ enabled: await isMemberDocumentsEnabled() }).toNextResponse()
}
