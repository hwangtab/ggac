import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getOwnedMemberDocument,
  renameOwnedMemberDocument,
  touchOwnedMemberDocument,
} from '@/db/queries/memberDocuments'
import { normalizeRename, retentionActionOf } from '@/lib/memberDocuments/rules'
import { deleteMemberDocument, versionView } from '@/lib/memberDocuments/service'
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

type Ctx = { params: Promise<{ id: string }> }

/**
 * /api/mypage/documents/<문서 id> — 내 문서 하나(docs/board-work/04-조합원-문서함.md §4).
 *   GET    문서 + 버전 목록. 열람으로 센다(보존 시계를 처음부터 — §6).
 *   PATCH  `{ name }` 이름 바꾸기(확장자는 그대로).
 *   DELETE 지우기(모든 버전 객체 → 행 → 미리보기 캐시).
 * 게이트: requireActiveMember → 스위치(503) → (쓰기) 레이트 리밋 → 소유 판정(`owner_id = 나`, 남의 id 는 404).
 */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off

  const { id } = await ctx.params
  if (!isUuid(id)) return memberDocumentNotFound()
  const found = await getOwnedMemberDocument(auth.user.id, id)
  if (!found) return memberDocumentNotFound()
  const touched = await touchOwnedMemberDocument(auth.user.id, id).catch(() => false)

  // 방금 열어 보존 시계를 되돌렸으면 그 상태로 답한다(읽은 행은 열기 전 값이라 "곧 지워짐"으로 나왔다 — 2026-11-05 리뷰)
  const now = new Date()
  const d = touched
    ? { ...found.document, lastOpenedAt: now, deletionNotifiedAt: null }
    : found.document
  return ApiSuccess.ok({
    document: {
      id: d.id,
      name: d.name,
      latestVersionNo: d.latestVersionNo,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      retention: retentionActionOf(d, now),
    },
    versions: found.versions.map(versionView),
  }).toNextResponse()
}

const renameSchema = z.object({ name: z.string().max(300) })

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off
  const limited = await limitMemberDocumentWrite(auth.user.id)
  if (limited) return limited

  const { id } = await ctx.params
  if (!isUuid(id)) return memberDocumentNotFound()
  const found = await getOwnedMemberDocument(auth.user.id, id)
  if (!found) return memberDocumentNotFound()

  const parsed = renameSchema.safeParse(await parseJsonObjectBody(request))
  const name = parsed.success ? normalizeRename(parsed.data.name, found.document.name) : null
  if (!name) return ApiError.badRequest('이름을 확인해 주세요.').toNextResponse()
  if (!(await renameOwnedMemberDocument(auth.user.id, id, name))) return memberDocumentNotFound()
  return ApiSuccess.ok({ id, name }).toNextResponse()
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const auth = await requireActiveMember()
  if (auth instanceof NextResponse) return auth
  const off = await memberDocumentsOff()
  if (off) return off
  const limited = await limitMemberDocumentWrite(auth.user.id)
  if (limited) return limited

  const { id } = await ctx.params
  if (!isUuid(id)) return memberDocumentNotFound()
  const result = await deleteMemberDocument(auth.user.id, id)
  if (!result.ok) return new ApiError(result.error, result.status).toNextResponse()
  return ApiSuccess.ok({ deleted: true }).toNextResponse()
}
