import { NextResponse, type NextRequest } from 'next/server'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { readFormSchema } from '@work/lib/files/doc-edit'
import {
  DOC_EDIT_PRIVATE_HEADERS,
  docEditErrorResponse,
  hitDocEditLimit,
  openEditable,
  readOriginal,
} from '@work/lib/files/doc-edit-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/board-room/work/files/<attachment id>/form — HWP·HWPX 양식 칸 스키마(JSON: fields · clickHere · confidence · format). docs/10 §3-1.
 * 원본 kosmart-work `api/files/[id]/form`. 권한: requireBoardMember(이사·감사·관리자) → 업무툴 역할 → 읽기(읽기 범위,
 * 아니면 404) → 편집 권한(채널 멤버·보관 아님, 아니면 403). 파일 바이트는 응답에 싣지 않는다.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const opened = await openEditable(auth.user.id, id)
  if (!opened.ok) return opened.response

  const limited = await hitDocEditLimit(opened.ctx.user.id, 'read')
  if (limited) return limited

  const original = await readOriginal(opened.ctx)
  if (!original.ok) return original.response

  try {
    const result = await readFormSchema(original.bytes)
    return NextResponse.json(result, { headers: DOC_EDIT_PRIVATE_HEADERS })
  } catch (e) {
    return docEditErrorResponse(e, 'board-work/files/form')
  }
}
