import { NextRequest, NextResponse } from 'next/server'
import {
  getOwnedMemberDocumentVersion,
  touchOwnedMemberDocument,
} from '@/db/queries/memberDocuments'
import { readMemberDocumentObject } from '@/lib/memberDocuments/storage'
import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  isUuid,
  memberDocumentNotFound,
  memberDocumentsOff,
} from '@/lib/server/memberDocumentsRoute'
import { isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import {
  attachmentDisposition,
  inlineDisposition,
  NOT_FRAMEABLE,
  streamObject,
} from '@work/lib/files/file-response'
import { canInlinePreview, resolveMime } from '@work/lib/files/mime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/mypage/documents/files/<버전 id> — 내 문서 한 버전의 원본(docs/board-work/04-조합원-문서함.md §4).
 * `?download=1`은 attachment(+ octet-stream)이고 **열람으로 센다**(보존 시계를 처음부터 — 편집기도 이 주소로 원본을
 * 받는다). 그 밖에는 이미지·PDF·동영상·오디오만 inline, 나머지는 attachment. 프레임 금지. Range 지원(업무툴과 같은
 * `streamObject` — 저장소 계층만 문서함 것).
 * 게이트: requireActiveMember → 스위치(503) → 소유 판정(남의 버전 id 는 404) → 객체 경로가 내 문서함 키인가.
 * 미리보기 부품(FilePreviewBody)이 `<base>/<id>`로 부르는 모양이라 업무툴 첨부 라우트와 같은 자리다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ versionId: string }> }) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off

  const { versionId } = await ctx.params
  if (!isUuid(versionId)) return memberDocumentNotFound()
  const found = await getOwnedMemberDocumentVersion(auth.user.id, versionId)
  if (!found || !isMemberDocumentPathOf(found.version.blobPath, auth.user.id)) {
    return memberDocumentNotFound()
  }
  const v = found.version

  const forceDownload = request.nextUrl.searchParams.get('download') === '1'
  if (forceDownload)
    await touchOwnedMemberDocument(auth.user.id, found.document.id).catch(() => false)
  const inline = !forceDownload && canInlinePreview(v.mime, v.name, v.size)
  return streamObject({
    path: v.blobPath,
    size: v.size,
    rangeHeader: request.headers.get('range'),
    where: 'member-documents/files',
    read: readMemberDocumentObject,
    headers: {
      'Content-Type': inline ? resolveMime(v.mime, v.name) : 'application/octet-stream',
      'Content-Disposition': inline ? inlineDisposition(v.name) : attachmentDisposition(v.name),
      ...NOT_FRAMEABLE,
    },
  })
}
