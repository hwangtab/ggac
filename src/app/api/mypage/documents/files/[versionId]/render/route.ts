import { NextRequest, NextResponse } from 'next/server'
import { getOwnedMemberDocumentVersion } from '@/db/queries/memberDocuments'
import { downloadMemberDocumentObject } from '@/lib/memberDocuments/storage'
import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  isUuid,
  memberDocumentNotFound,
  memberDocumentsOff,
} from '@/lib/server/memberDocumentsRoute'
import { isMemberDocumentPathOf } from '@/lib/storage/memberDocuments'
import { renderFileResponse } from '@work/lib/files/render-response'
import { RENDER_MAX_BYTES } from '@work/lib/files/render-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 변환 타임아웃(30초)보다 넉넉히 — 다운로드·캐시 저장 시간 포함(업무툴 render 라우트와 같다)
export const maxDuration = 60

/**
 * GET /api/mypage/documents/files/<버전 id>/render — 문서·시트 뷰어(kordoc — HWP 원본 모양·DOCX·XLSX·PPTX). 변환·캐시·
 * 보호 장치는 업무툴과 같은 `renderFileResponse`다(자료실의 이사회 서류와 같은 재사용 — 03 §10). 원본은 문서함 저장소에서
 * 읽고, 변환 결과는 업무툴 캐시(`board-work/renders/<버전 id>-…`)에 둔다 — 문서를 지우면 함께 지운다.
 * 게이트: requireActiveMember → 스위치(503) → 소유 판정(남의 버전 id 는 404) → 객체 경로가 내 문서함 키인가.
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

  return renderFileResponse(request, auth.user.id, {
    id: v.id,
    name: v.name,
    size: v.size,
    readOriginal: async () => {
      const bytes = await downloadMemberDocumentObject(v.blobPath)
      if (bytes.length > RENDER_MAX_BYTES) throw new Error('파일이 너무 큽니다')
      return bytes
    },
  })
}
