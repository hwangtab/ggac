import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOwnedMemberDocument } from '@/db/queries/memberDocuments'
import { addUploadedVersion } from '@/lib/memberDocuments/promote'
import { restoreVersion } from '@/lib/memberDocuments/service'
import { requireActiveMember } from '@/lib/server/memberAuth'
import {
  isUuid,
  limitMemberDocumentWrite,
  memberDocumentNotFound,
  memberDocumentsOff,
} from '@/lib/server/memberDocumentsRoute'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { parseJsonObjectBody } from '@/utils/requestBody'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// HWP·HWPX 편집기 저장본: 원본·저장본 읽기 + kordoc 두 번 읽기 + 쪽 수 비교
export const maxDuration = 60

const bodySchema = z.union([
  z.object({
    uploadId: z.string().uuid(),
    source: z.enum(['upload', 'editor']),
    baseVersionNo: z.number().int().min(1).nullable().optional(),
  }),
  z.object({ restoreVersionId: z.string().uuid() }),
])

/**
 * POST /api/mypage/documents/<문서 id>/versions — 새 버전(docs/board-work/04-조합원-문서함.md §4·§9).
 *   `{ uploadId, source: 'upload'|'editor', baseVersionNo? }` 임시 업로드를 새 최신 버전으로. 편집기 저장본(HWP·HWPX)은
 *     기준 버전과 비교 검사한 뒤에만 버전이 된다(막히면 422, 객체를 치운다). `baseVersionNo`가 최신이 아니면 409.
 *   `{ restoreVersionId }` 그 버전을 복사해 새 최신 버전으로(되돌리기).
 * 용량(200MB)은 실제 크기로 다시 본다(넘으면 413). 게이트: requireActiveMember → 스위치(503) → 쓰기 레이트 리밋
 * (편집기 저장은 검사 한도도) → 소유 판정(남의 문서 id 는 404).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off
  const limited = await limitMemberDocumentWrite(auth.user.id)
  if (limited) return limited

  const { id } = await ctx.params
  if (!isUuid(id)) return memberDocumentNotFound()
  const owned = await getOwnedMemberDocument(auth.user.id, id)
  if (!owned) return memberDocumentNotFound()

  const parsed = bodySchema.safeParse(await parseJsonObjectBody(request))
  if (!parsed.success) return ApiError.badRequest('요청 내용을 확인해 주세요.').toNextResponse()
  const body = parsed.data as {
    uploadId?: string
    source?: 'upload' | 'editor'
    baseVersionNo?: number | null
    restoreVersionId?: string
  }

  try {
    if (body.restoreVersionId) {
      const restored = await restoreVersion(auth.user.id, id, body.restoreVersionId)
      if (!restored.ok) return new ApiError(restored.error, restored.status).toNextResponse()
      return ApiSuccess.created(restored.data).toNextResponse()
    }
    if (body.source === 'editor') {
      const verifyLimited = await limitMemberDocumentWrite(auth.user.id, 'verify')
      if (verifyLimited) return verifyLimited
    }
    const added = await addUploadedVersion(auth.user.id, id, {
      uploadId: body.uploadId,
      source: body.source,
      baseVersionNo: body.baseVersionNo ?? null,
    })
    if (!added.ok) return new ApiError(added.error, added.status).toNextResponse()
    return ApiSuccess.created(added.data).toNextResponse()
  } catch (e) {
    // 문서 내용이 섞일 수 있어 메시지는 남기지 않는다
    console.error('[member-documents/versions] 실패:', e instanceof Error ? e.name : typeof e)
    return ApiError.internalServerError('새 버전을 저장하지 못했습니다.').toNextResponse()
  }
}
