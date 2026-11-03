import { NextResponse, type NextRequest } from 'next/server'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { readEditableBlocks } from '@work/lib/files/doc-edit'
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
 * GET /api/board-room/work/files/<attachment id>/blocks — 문구 고치기용 블록(문단·표 셀, 원본 구조 해시 포함). docs/10 §3-1.
 * 원본 kosmart-work `api/files/[id]/blocks`. 권한: requireBoardMember(이사·감사·관리자) → 업무툴 역할 → 읽기(읽기 범위,
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
    const result = await readEditableBlocks(original.bytes)
    return NextResponse.json(result, { headers: DOC_EDIT_PRIVATE_HEADERS })
  } catch (e) {
    return docEditErrorResponse(e, 'board-work/files/blocks')
  }
}
