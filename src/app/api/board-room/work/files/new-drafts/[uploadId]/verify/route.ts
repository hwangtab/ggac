import { NextResponse, type NextRequest } from 'next/server'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { z } from 'zod'
import { getPendingUpload } from '@/db/queries/work/files'
import { setPendingDraftMeta } from '@/db/queries/work/versions'
import { checkCreateAccess } from '@work/lib/files/create-access-check'
import { inspectHwpxEditorSave } from '@work/lib/files/doc-edit'
import { discardDraftUpload, saveDraftLayoutFor } from '@work/lib/files/doc-edit-draft'
import { renderPages } from '@work/lib/files/doc-edit-pages'
import {
  DOC_EDIT_PRIVATE_HEADERS,
  docEditClient,
  docEditErrorResponse,
  docEditFail,
  hitDocEditLimit,
} from '@work/lib/files/doc-edit-route'
import { isDraftMeta, type DraftMeta, type DraftOutcome } from '@work/lib/files/doc-edit-types'
import type { LayoutResult } from '@work/lib/files/render-layout'
import { DOC_EDIT_MAX_BYTES } from '@work/lib/files/render-types'
import { downloadObject } from '@work/lib/files/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// 저장본 읽기 + kordoc 검증 + 쪽 렌더 + 저장
export const maxDuration = 60

const uuid = z.string().uuid()
const bodySchema = z.object({ parentId: z.string().uuid().nullish() }).strict()

/**
 * POST /api/board-room/work/files/new-drafts/<uploadId>/verify — 새 한글 문서(HWPX)의 첫 저장본 서버 검증(docs/18 §2-4).
 * 원본 kosmart-work `api/files/new-drafts/[uploadId]/verify`. 권한: requireBoardMember → 업무툴 역할 → 사용량 → 내 임시 업로드 →
 * 만들기 권한(checkCreateAccess). 원본 첨부가 없으므로 경로에 첨부 id 가 없다. `uploadId` 는 브라우저가 올린 **내 임시 업로드**(같은 채널 안에서 만들 권한이 있어야 한다 —
 * 멤버·서브관리자·보관·공지 채널·스레드 부모, `createDocument` 와 같은 판정). 형식(HWPX) · validateHwpx · 다시 읽기만 보고(원본 비교 없음),
 * 결과를 `draft_meta { mode:'hwp-editor', format:'hwpx', newDocument:true }` 로 기록한다 — `createDocument` 가 이 메타로 막힌 저장본·다른 경로의 파일을 다시 거부한다.
 * 문서 내용·입력값은 로그에 남기지 않는다.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uploadId: string }> }
): Promise<NextResponse> {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const startedAt = Date.now()
  const { uploadId } = await ctx.params
  if (!uuid.safeParse(uploadId).success) return docEditFail('not_found')

  const guard = await docEditClient(auth.user.id)
  if (guard instanceof NextResponse) return guard

  let parentId: string | null = null
  try {
    const raw: unknown = await req.json()
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return docEditFail('bad_request')
    parentId = parsed.data.parentId ?? null
  } catch {
    return docEditFail('bad_request')
  }

  const limited = await hitDocEditLimit(guard.user.id, 'draft')
  if (limited) return limited

  let row: Awaited<ReturnType<typeof getPendingUpload>>
  try {
    row = await getPendingUpload(uploadId, guard.user.id)
  } catch {
    return docEditFail('server')
  }
  if (!row) return docEditFail('not_found')
  if (
    row.draftMeta !== null &&
    row.draftMeta !== undefined &&
    !(
      isDraftMeta(row.draftMeta) &&
      row.draftMeta.mode === 'hwp-editor' &&
      row.draftMeta.newDocument === true
    )
  ) {
    return docEditFail('not_found')
  }
  if (row.size > DOC_EDIT_MAX_BYTES) return docEditFail('too_large')

  // 새 문서를 만들 수 있는 대화인가 — createDocument 와 같은 판정(서브관리자 포함)
  const access = await checkCreateAccess(guard, row.channelId, parentId)
  if (!access.ok) {
    return docEditFail(access.reason === 'forbidden' ? 'forbidden' : 'not_found', access.message)
  }

  let saved: Buffer
  try {
    saved = await downloadObject(row.blobPath)
  } catch {
    return docEditFail('not_found', '올린 저장본을 찾을 수 없습니다. 다시 저장해 주세요.')
  }
  if (saved.length > DOC_EDIT_MAX_BYTES) return docEditFail('too_large')

  let blockedReason: string | null
  let pageCount: number | null = null
  let layout: LayoutResult | null = null
  try {
    blockedReason = (await inspectHwpxEditorSave(null, saved)).blockedReason
    if (!blockedReason) {
      layout = await renderPages(saved, row.name, startedAt)
      pageCount = layout && !layout.truncated ? layout.pages.length : null
      // 새 문서는 비교할 원본이 없다 — 쪽 그림을 못 그려도 막지는 않는다(미리보기만 없다)
    }
  } catch (e) {
    return docEditErrorResponse(e, 'api/files/new-drafts/verify')
  }

  const blocked = blockedReason !== null
  const meta: DraftMeta = {
    kind: 'doc-edit',
    mode: 'hwp-editor',
    newDocument: true,
    format: 'hwpx',
    blocked,
    applied: 0,
    skipped: 0,
  }
  try {
    if (!(await setPendingDraftMeta(row.id, guard.user.id, meta))) return docEditFail('not_found')
  } catch {
    return docEditFail('server')
  }

  let previewAvailable = false
  if (!blocked && layout) {
    previewAvailable = await saveDraftLayoutFor(row, layout)
  }
  if (blocked) {
    // 막힌 저장본은 쓸 곳이 없다 — 객체·행을 바로 치운다(실패해도 정리 크론이 한다)
    await discardDraftUpload(row).catch(() => undefined)
  }

  const outcome: DraftOutcome = {
    uploadId: row.id,
    mode: 'hwp-editor',
    format: 'hwpx',
    applied: 0,
    skipped: [],
    unmatched: [],
    verification: null,
    warnings: [],
    pageCount,
    originalPageCount: null,
    previewAvailable,
    blocked,
    blockedReason,
  }
  return NextResponse.json(outcome, { headers: DOC_EDIT_PRIVATE_HEADERS })
}
