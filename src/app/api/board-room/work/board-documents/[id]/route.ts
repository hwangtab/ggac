import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import {
  boardDocumentOr404,
  boardDocumentStream,
  redirectToDownload,
} from '@work/lib/files/board-documents'
import {
  inlineDisposition,
  jsonError,
  NO_STORE,
  NOT_FRAMEABLE,
  workClientFor,
} from '@work/lib/files/file-response'
import { previewKindOf, resolveMime } from '@work/lib/files/mime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/board-room/work/board-documents/<서류 id> — 자료실 미리보기의 이미지(`<img>`)용(03 §10). 업무툴 첨부
 * 라우트(`/api/board-room/work/files/<id>`)와 같은 자리다.
 * - `?download=1`과 이미지가 아닌 형식은 기존 서류 다운로드 라우트로 302(그쪽이 매 요청 권한을 다시 본다).
 * - 이미지는 inline으로 흘려보낸다(프레임 불가).
 *
 * 권한: requireBoardMember → 업무툴 역할 → 서류 등급·저장 경로 판정(`boardDocumentOr404`). 그 뒤에야 저장소를 읽는다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'Not Found')

  const client = await workClientFor(auth.user.id)
  if (client instanceof NextResponse) return client
  const doc = await boardDocumentOr404(id)
  if (doc instanceof NextResponse) return doc

  const kind = previewKindOf(doc.mime, doc.name, doc.size)
  if (request.nextUrl.searchParams.get('download') === '1' || kind !== 'image') {
    return redirectToDownload(doc.id, request.url)
  }

  let object: Awaited<ReturnType<typeof boardDocumentStream>>
  try {
    object = await boardDocumentStream(doc)
  } catch (e) {
    console.error('[board-work/board-documents] 저장소 읽기 실패:', e)
    return jsonError(502, 'Bad Gateway')
  }
  if (!object?.stream) return jsonError(404, 'Not Found')
  return new NextResponse(object.stream, {
    status: 200,
    headers: {
      ...NO_STORE,
      ...NOT_FRAMEABLE,
      'Content-Type': resolveMime(doc.mime, doc.name),
      'Content-Disposition': inlineDisposition(doc.name),
    },
  })
}
