import { NextRequest, NextResponse } from 'next/server'
import { getOwnedMemberDocumentVersion } from '@/db/queries/memberDocuments'
import { readMemberDocumentObject } from '@/lib/memberDocuments/storage'
import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  isUuid,
  memberDocumentNotFound,
  memberDocumentsOff,
} from '@/lib/server/memberDocumentsRoute'
import { isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import {
  inlineDisposition,
  jsonError,
  SAME_ORIGIN_FRAMEABLE,
  streamObject,
  TEXT_FRAMEABLE,
} from '@work/lib/files/file-response'
import { previewKindOf, resolveMime, TEXT_PREVIEW_MAX_BYTES } from '@work/lib/files/mime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/mypage/documents/files/<버전 id>/<원래 파일명> — 미리보기(PDF `<iframe>`·텍스트·이미지). 업무툴 첨부의
 * `/files/<id>/<name>`과 같은 규칙: PDF·이미지는 원래 형식 inline + 같은 출처 프레임만, 텍스트는 text/plain + CSP sandbox
 * (1MB 상한), 그 밖은 내려받기(`../`)로 302. 뒤의 <name>은 표시용이고 대상은 id 로만 정한다.
 * 게이트: requireActiveMember → 스위치(503) → 소유 판정(남의 버전 id 는 404) → 객체 경로가 내 문서함 키인가.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ versionId: string; name: string }> }
) {
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

  const kind = previewKindOf(v.mime, v.name, v.size)
  if (kind !== 'pdf' && kind !== 'image' && kind !== 'text') {
    return NextResponse.redirect(
      new URL(`/api/mypage/documents/files/${v.id}?download=1`, request.url),
      { status: 302, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
  if (kind === 'text' && v.size > TEXT_PREVIEW_MAX_BYTES) return jsonError(413, 'Too Large')
  return streamObject({
    path: v.blobPath,
    size: v.size,
    rangeHeader: request.headers.get('range'),
    where: 'member-documents/files/name',
    read: readMemberDocumentObject,
    headers: {
      'Content-Type': kind === 'text' ? 'text/plain; charset=utf-8' : resolveMime(v.mime, v.name),
      'Content-Disposition': inlineDisposition(v.name),
      ...(kind === 'text' ? TEXT_FRAMEABLE : SAME_ORIGIN_FRAMEABLE),
    },
  })
}
