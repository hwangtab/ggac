import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import {
  attachmentDisposition,
  inlineDisposition,
  jsonError,
  NOT_FRAMEABLE,
  readableAttachmentOr404,
  storageErrorResponse,
  streamObject,
  workClientFor,
} from '@work/lib/files/file-response'
import { canInlinePreview, resolveMime } from '@work/lib/files/mime'
import { thumbPathOf } from '@work/lib/files/paths'
import { readObject } from '@work/lib/files/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/board-room/work/files/<attachment id>[?thumb=1|?download=1] — 원본 kosmart-work `api/files/[id]`.
 *
 * 원본은 멤버십 검사 뒤 서명 URL 로 302 했다. ggac 비공개 Blob 에는 서명 URL 이 없어 **요청마다** 권한을 다시 판정한 뒤
 * 함수가 스트리밍한다(설계 §7-3). 동영상·오디오 탐색을 위해 단일 `Range`(bytes=a-b)를 저장소에 넘기고 206 으로 돌려준다.
 *  - 게이트: requireBoardMember(이사·감사·관리자) → 업무툴 역할 → 읽을 수 있는 채널의 지워지지 않은 메시지 첨부
 *    (원본 getReadableAttachment). 아니면 404(없음과 구분하지 않는다).
 *  - 기본: 이미지(SVG 제외)·PDF·동영상·오디오는 inline, 그 밖의 형식은 늘 내려받기(attachment)
 *  - thumb=1: webp 썸네일(없으면 원본 — 원본처럼 폴백)
 *  - download=1: 강제 내려받기
 *  - 경로는 DB 행에서만 오고, 저장소 호출 전에 업무툴 경로 검사를 다시 거친다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'Not Found')

  const client = await workClientFor(auth.user.id)
  if (client instanceof NextResponse) return client
  const attachment = await readableAttachmentOr404(client, id)
  if (attachment instanceof NextResponse) return attachment

  const params = request.nextUrl.searchParams
  const forceDownload = params.get('download') === '1'

  if (params.get('thumb') === '1' && !forceDownload) {
    try {
      const thumb = await readObject(thumbPathOf(attachment.bucket_path))
      if (thumb) {
        return new NextResponse(thumb.stream, {
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Type': 'image/webp',
            ...(thumb.contentLength ? { 'Content-Length': thumb.contentLength } : {}),
            ...NOT_FRAMEABLE,
          },
        })
      }
    } catch (e) {
      return storageErrorResponse(e, 'board-work/files thumb')
    }
  }

  const inline =
    !forceDownload && canInlinePreview(attachment.mime, attachment.name, attachment.size)
  return streamObject({
    path: attachment.bucket_path,
    size: attachment.size,
    rangeHeader: request.headers.get('range'),
    where: 'board-work/files',
    headers: {
      // 내려받기는 형식을 믿지 않는다 — 브라우저가 화면에 그리지 않게 octet-stream 으로
      'Content-Type': inline
        ? resolveMime(attachment.mime, attachment.name)
        : 'application/octet-stream',
      'Content-Disposition': inline
        ? inlineDisposition(attachment.name)
        : attachmentDisposition(attachment.name),
      ...NOT_FRAMEABLE,
    },
  })
}
