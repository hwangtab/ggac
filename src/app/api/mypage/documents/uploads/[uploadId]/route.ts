import { NextResponse } from 'next/server'
import { discardMemberDocumentUpload } from '@/lib/memberDocuments/service'
import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  isUuid,
  limitMemberDocumentWrite,
  memberDocumentsOff,
} from '@/lib/server/memberDocumentsRoute'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/mypage/documents/uploads/<uploadId> — 실패·취소한 내 임시 업로드를 버린다(객체 → 행). 남은 행은 24시간
 * 동안 용량에 자리를 잡으므로 화면이 곧바로 부른다. 소유 판정: 쿼리가 `owner_id = 나`인 행만 찾는다(남의 id 는 404).
 * 게이트: requireActiveMember → 스위치(503) → 쓰기 레이트 리밋.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ uploadId: string }> }) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off
  const limited = await limitMemberDocumentWrite(auth.user.id)
  if (limited) return limited

  const { uploadId } = await ctx.params
  if (!isUuid(uploadId))
    return ApiError.notFound('업로드 정보를 찾을 수 없습니다.').toNextResponse()
  const result = await discardMemberDocumentUpload(auth.user.id, uploadId)
  if (!result.ok) return new ApiError(result.error, result.status).toNextResponse()
  return ApiSuccess.ok({ discarded: true }).toNextResponse()
}
