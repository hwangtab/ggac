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
  SAME_ORIGIN_FRAMEABLE,
  TEXT_FRAMEABLE,
  workClientFor,
} from '@work/lib/files/file-response'
import { previewKindOf, resolveMime, TEXT_PREVIEW_MAX_BYTES } from '@work/lib/files/mime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/board-room/work/board-documents/<서류 id>/<원래 파일명> — 자료실 미리보기(PDF `<iframe>`·텍스트, 03 §10).
 * 업무툴 첨부의 `/files/<id>/<name>`과 같은 규칙이다: PDF·이미지는 원래 형식으로 inline + 같은 출처 프레임만,
 * 텍스트는 text/plain + CSP sandbox(1MB 상한), 그 밖의 형식(HWP·DOCX·XLSX — `/render` 뷰어 전용)은 내려받기로 302.
 * 뒤의 <name>은 표시용이고 대상은 id로만 정한다.
 *
 * 권한: requireBoardMember → 업무툴 역할 → 서류 등급·저장 경로 판정(`boardDocumentOr404`). 그 뒤에야 저장소를 읽는다.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; name: string }> }
) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'Not Found')

  const client = await workClientFor(auth.user.id)
  if (client instanceof NextResponse) return client
  const doc = await boardDocumentOr404(id)
  if (doc instanceof NextResponse) return doc

  const kind = previewKindOf(doc.mime, doc.name, doc.size)
  if (kind !== 'pdf' && kind !== 'image' && kind !== 'text') {
    return redirectToDownload(doc.id, request.url)
  }
  if (kind === 'text' && doc.size > TEXT_PREVIEW_MAX_BYTES) return jsonError(413, 'Too Large')

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
      'Content-Type':
        kind === 'text' ? 'text/plain; charset=utf-8' : resolveMime(doc.mime, doc.name),
      'Content-Disposition': inlineDisposition(doc.name),
      ...(kind === 'text' ? TEXT_FRAMEABLE : SAME_ORIGIN_FRAMEABLE),
    },
  })
}
