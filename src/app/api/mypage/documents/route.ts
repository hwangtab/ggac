import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMemberDocumentUsage, listMemberDocuments } from '@/db/queries/memberDocuments'
import { MEMBER_DOCUMENT_QUOTA_BYTES } from '@/lib/memberDocuments/rules'
import { createMemberDocument } from '@/lib/memberDocuments/promote'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { limitMemberDocumentWrite, memberDocumentsOff } from '@/lib/server/memberDocumentsRoute'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 편집기에서 처음 저장한 새 HWPX 는 kordoc 으로 저장본을 검사한다
export const maxDuration = 60

/**
 * GET  /api/mypage/documents — 내 문서 목록 + 사용량(docs/board-work/04-조합원-문서함.md §4).
 * POST /api/mypage/documents — 임시 업로드(`uploadId`)를 새 문서 v1 로 승격한다. `source`는 'upload'(파일 올리기)·
 *      'editor'(새 문서를 편집기에서 처음 저장).
 *
 * 게이트: requireActiveMember → 스위치(꺼지면 503) → (POST) 쓰기 레이트 리밋 → 내 행만(쿼리가 owner_id 로 거른다).
 */
export async function GET() {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off

  const [documents, usage] = await Promise.all([
    listMemberDocuments(auth.user.id),
    getMemberDocumentUsage(auth.user.id),
  ])
  return ApiSuccess.ok({
    documents: documents.map(d => ({
      id: d.id,
      name: d.name,
      latestVersionNo: d.latestVersionNo,
      latestVersionId: d.latestVersionId,
      mime: d.mime,
      size: d.size,
      totalSize: d.totalSize,
      versionCount: d.versionCount,
      updatedAt: d.updatedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      deletionNotifiedAt: d.deletionNotifiedAt ? d.deletionNotifiedAt.toISOString() : null,
    })),
    usage: { ...usage, quota: MEMBER_DOCUMENT_QUOTA_BYTES },
  }).toNextResponse()
}

const createSchema = z.object({
  uploadId: z.string().uuid(),
  source: z.enum(['upload', 'editor']).optional().default('upload'),
})

export async function POST(request: NextRequest) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off
  const limited = await limitMemberDocumentWrite(auth.user.id)
  if (limited) return limited

  const parsed = createSchema.safeParse(await parseJsonObjectBody(request))
  if (!parsed.success) return ApiError.badRequest('요청 내용을 확인해 주세요.').toNextResponse()

  try {
    const result = await createMemberDocument(auth.user.id, parsed.data)
    if (!result.ok) return new ApiError(result.error, result.status).toNextResponse()
    return ApiSuccess.created(result.data).toNextResponse()
  } catch (e) {
    console.error('[member-documents] 새 문서 실패:', e instanceof Error ? e.name : typeof e)
    return ApiError.internalServerError('문서를 만들지 못했습니다.').toNextResponse()
  }
}
