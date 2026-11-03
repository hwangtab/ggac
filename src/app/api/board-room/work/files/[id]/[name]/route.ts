import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import {
  inlineDisposition,
  jsonError,
  readableAttachmentOr404,
  SAME_ORIGIN_FRAMEABLE,
  streamObject,
  TEXT_FRAMEABLE,
  workClientFor,
} from '@work/lib/files/file-response'
import { previewKindOf, resolveMime, TEXT_PREVIEW_MAX_BYTES } from '@work/lib/files/mime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/board-room/work/files/<attachment id>/<원래 파일명> — 미리보기 전용(원본 `api/files/[id]/[name]`, QA #21).
 * 주소의 마지막 조각과 Content-Disposition 이 원래 파일명이 되게 내용을 직접 흘려보낸다(브라우저 PDF 뷰어 제목).
 * 뒤의 <name> 은 표시용이고 권한·대상은 id 로만 정한다.
 *
 * **같은 출처 `<iframe>`에 뜨는 유일한 파일 라우트다**(PDF 미리보기, 설계 §7-3) — 전역은 X-Frame-Options DENY·
 * frame-ancestors 'none'이지만 이 응답만 SAMEORIGIN·'self'로 둔다.
 * - PDF·이미지: 원래 형식으로 inline.
 * - 텍스트(.txt/.md/.csv/.json/.log 등): text/plain(UTF-8) + nosniff + CSP sandbox — 1MB 를 넘으면 413.
 * - 동영상·오디오: 스트리밍 라우트(`…/files/<id>`, Range)로 302.
 * - 그 밖의 형식: 미리보기 대상이 아니다 → 내려받기 경로로 보낸다.
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
  const attachment = await readableAttachmentOr404(client, id)
  if (attachment instanceof NextResponse) return attachment

  const kind = previewKindOf(attachment.mime, attachment.name, attachment.size)
  const base = `/api/board-room/work/files/${attachment.id}`
  // 동영상·오디오는 Range 를 처리하는 스트리밍 라우트가 맡는다.
  if (kind === 'video' || kind === 'audio') {
    return NextResponse.redirect(new URL(base, request.url), {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  // 문서·시트는 /render 뷰어 전용 — 이 경로는 원본을 inline 으로 흘리지 않는다(내려받기로).
  if (!kind || kind === 'document' || kind === 'sheet') {
    return NextResponse.redirect(new URL(`${base}?download=1`, request.url), {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  if (kind === 'text' && attachment.size > TEXT_PREVIEW_MAX_BYTES) {
    return jsonError(413, 'Too Large')
  }

  return streamObject({
    path: attachment.bucket_path,
    size: attachment.size,
    rangeHeader: kind === 'pdf' ? request.headers.get('range') : null,
    where: 'board-work/files/name',
    headers: {
      'Content-Type':
        kind === 'text'
          ? 'text/plain; charset=utf-8'
          : resolveMime(attachment.mime, attachment.name),
      'Content-Disposition': inlineDisposition(attachment.name),
      // 텍스트는 같은 출처에서 열려도 스크립트가 돌 수 없게(PDF 는 sandbox 면 크롬 뷰어가 막혀 제외)
      ...(kind === 'text' ? TEXT_FRAMEABLE : SAME_ORIGIN_FRAMEABLE),
    },
  })
}
