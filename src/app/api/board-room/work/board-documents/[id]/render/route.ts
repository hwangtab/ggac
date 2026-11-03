import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { boardDocumentOr404, readBoardDocumentBytes } from '@work/lib/files/board-documents'
import { jsonError, workClientFor } from '@work/lib/files/file-response'
import { renderFileResponse } from '@work/lib/files/render-response'
import { RENDER_MAX_BYTES } from '@work/lib/files/render-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 변환 타임아웃(30초)보다 넉넉히 — 다운로드·캐시 저장 시간 포함(첨부 render 라우트와 같다)
export const maxDuration = 60

/**
 * GET /api/board-room/work/board-documents/<서류 id>/render — 자료실의 이사회 서류를 업무툴 문서 뷰어(kordoc — HWP 원본
 * 모양·DOCX·XLSX)로 본다(03 §10). 변환·캐시·보호 장치는 첨부 render 라우트와 같은 `renderFileResponse`다.
 * 원본은 서류 저장소(`board-documents/…`)에서 읽고, 변환 결과는 업무툴 캐시(`board-work/renders/<서류 id>-…`)에 둔다.
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

  return renderFileResponse(request, auth.user.id, {
    id: doc.id,
    name: doc.name,
    size: doc.size,
    readOriginal: () => readBoardDocumentBytes(doc, RENDER_MAX_BYTES),
  })
}
