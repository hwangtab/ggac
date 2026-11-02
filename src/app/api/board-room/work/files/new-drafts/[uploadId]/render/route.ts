import { NextResponse, type NextRequest } from 'next/server'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { z } from 'zod'
import { loadChannelAccess, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { draftManifestPath, draftPagePath, getMyDraft } from '@work/lib/files/doc-edit-draft'
import {
  DOC_EDIT_PRIVATE_HEADERS,
  DRAFT_SVG_HEADERS,
  docEditClient,
  docEditFail,
} from '@work/lib/files/doc-edit-route'
import { isLayoutManifest } from '@work/lib/files/render-types'
import { downloadObject } from '@work/lib/files/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const uuid = z.string().uuid()

/**
 * GET /api/board-room/work/files/new-drafts/<uploadId>/render?view=layout[&page=n] — 새 한글 문서 첫 저장본의 미리보기(docs/18 §2-4).
 * 내가 올린 새 문서 초안(draft_meta.newDocument)만. verify 때 저장해 둔 캐시를 그대로 내려 준다 — 여기서 다시 렌더하지 않는다.
 * 원본 kosmart-work `api/files/new-drafts/[uploadId]/render`. 권한: requireBoardMember → 업무툴 역할 → 내 초안 → 채널 읽기·보관 아님.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uploadId: string }> }
): Promise<NextResponse> {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const { uploadId } = await ctx.params
  if (!uuid.safeParse(uploadId).success) return docEditFail('not_found')
  if (req.nextUrl.searchParams.get('view') !== 'layout') return docEditFail('bad_request')

  const pageParam = req.nextUrl.searchParams.get('page')
  let page: number | null = null
  if (pageParam !== null) {
    if (!/^[1-9]\d{0,5}$/.test(pageParam)) return docEditFail('not_found')
    page = Number(pageParam)
  }

  const guard = await docEditClient(auth.user.id)
  if (guard instanceof NextResponse) return guard

  let draft: Awaited<ReturnType<typeof getMyDraft>>
  try {
    draft = await getMyDraft(guard.user.id, uploadId)
  } catch {
    return docEditFail('server')
  }
  if (!draft || draft.meta.newDocument !== true) return docEditFail('not_found')

  // 초안을 만든 뒤 권한이 바뀌었을 수 있다 — 채널을 지금도 읽을 수 있고 보관되지 않았는지 다시 확인
  try {
    const access = await loadChannelAccess(viewerOf(guard), draft.row.channelId)
    if (!access || !access.canRead) return docEditFail('not_found')
    if (access.archived) return docEditFail('forbidden')
  } catch {
    return docEditFail('server')
  }

  try {
    if (page === null) {
      const manifest: unknown = JSON.parse(
        (await downloadObject(draftManifestPath(uploadId))).toString('utf8')
      )
      if (!isLayoutManifest(manifest)) return docEditFail('not_found')
      return NextResponse.json(manifest, { headers: DOC_EDIT_PRIVATE_HEADERS })
    }
    const svg = await downloadObject(draftPagePath(uploadId, page))
    return new NextResponse(new Uint8Array(svg), { status: 200, headers: DRAFT_SVG_HEADERS })
  } catch {
    // 미리보기를 만들지 못한 초안이거나 정리됨
    return docEditFail('not_found')
  }
}
