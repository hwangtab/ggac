import { NextResponse, type NextRequest } from 'next/server'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { z } from 'zod'
import { inspectHwpEditorSave, inspectHwpxEditorSave } from '@work/lib/files/doc-edit'
import { discardDraftUpload, saveDraftLayoutFor } from '@work/lib/files/doc-edit-draft'
import { originalPageCount, renderPages } from '@work/lib/files/doc-edit-pages'
import {
  DOC_EDIT_PRIVATE_HEADERS,
  docEditErrorResponse,
  docEditFail,
  hitDocEditLimit,
  openEditable,
  readOriginal,
} from '@work/lib/files/doc-edit-route'
import {
  BLOCKED_MESSAGE,
  isDraftMeta,
  pageCountBlocked,
  type DraftMeta,
  type DraftOutcome,
  type ObjectsDropped,
} from '@work/lib/files/doc-edit-types'
import type { LayoutResult } from '@work/lib/files/render-layout'
import { DOC_EDIT_MAX_BYTES } from '@work/lib/files/render-types'
import { downloadObject } from '@work/lib/files/storage'
import { hwpEditFormatOf } from '@work/lib/files/hwp-editor'
import { getPendingUpload } from '@/db/queries/work/files'
import { setPendingDraftMeta } from '@/db/queries/work/versions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// 저장본·원본 읽기 + kordoc 두 번 읽기 + 쪽 수·미리보기 렌더 + 저장
export const maxDuration = 60

const uuid = z.string().uuid()

/**
 * POST /api/board-room/work/files/<원본 첨부 id>/drafts/<uploadId>/verify — HWP·HWPX 앱 안 편집(docs/12 §2-3 · docs/18 §2) 저장본 서버 검증.
 * `uploadId` 는 브라우저가 1단계 업로드로 올린 **내 임시 업로드**(저장본). 형식은 원본과 같아야 한다(HWP↔HWP, HWPX↔HWPX).
 * 원본 kosmart-work `api/files/[id]/drafts/[uploadId]/verify`. 권한: requireBoardMember → 업무툴 역할 → 원본 읽기(404) →
 * 편집 권한(403) → 사용량(WORK_DOC_EDIT_DRAFT) → 내 임시 업로드(같은 채널).
 * 그 객체를 읽어 — HWP: 형식(HWP 5.x) · kordoc 다시 읽기 · 블록 수 변화 · 쪽 수 차이 /
 * HWPX: 형식 · validateHwpx · 다시 읽기 · 누름틀 수(줄면 막힘) · 개체 수(줄면 `objectsDropped` 경고, 막지 않음 — 블록 수·쪽 수도 막지 않는다) —
 * 를 보고, 결과를 `work_pending_uploads.draft_meta`(mode 'hwp-editor', format, 0034 형식)에 기록한다 — `saveFileVersion` 이 막힌 저장본·다른 원본의 저장본을 이 메타로 다시 거부한다.
 * 통과하면 쪽 그림을 초안 옆에 저장해 기존 초안 미리보기 라우트(`…/render`)로 보여 줄 수 있게 한다.
 * 문서 내용·입력값은 로그·감사 로그에 남기지 않는다.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; uploadId: string }> }
): Promise<NextResponse> {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const startedAt = Date.now()
  const { id, uploadId } = await ctx.params
  if (!uuid.safeParse(uploadId).success) return docEditFail('not_found')

  const opened = await openEditable(auth.user.id, id)
  if (!opened.ok) return opened.response
  const c = opened.ctx
  // 앱 안 편집은 HWP 5.x(.hwp)·HWPX(.hwpx)
  const format = hwpEditFormatOf(c.attachment.name)
  if (!format) {
    return docEditFail('unsupported', 'HWP·HWPX 문서만 앱에서 편집할 수 있습니다.')
  }

  const limited = await hitDocEditLimit(c.user.id, 'draft')
  if (limited) return limited

  // 내 임시 업로드(같은 채널). 다른 초안(문구 고치기 등)의 행은 건드리지 않는다.
  let row: Awaited<ReturnType<typeof getPendingUpload>>
  try {
    row = await getPendingUpload(uploadId, c.user.id)
  } catch {
    return docEditFail('server')
  }
  if (!row || row.channelId !== c.attachment.channel_id) return docEditFail('not_found')
  if (
    row.draftMeta !== null &&
    row.draftMeta !== undefined &&
    !(isDraftMeta(row.draftMeta) && row.draftMeta.mode === 'hwp-editor')
  ) {
    return docEditFail('not_found')
  }
  if (row.size > DOC_EDIT_MAX_BYTES) return docEditFail('too_large')

  let saved: Buffer
  try {
    saved = await downloadObject(row.blobPath)
  } catch {
    return docEditFail('not_found', '올린 저장본을 찾을 수 없습니다. 다시 저장해 주세요.')
  }
  if (saved.length > DOC_EDIT_MAX_BYTES) return docEditFail('too_large')

  const original = await readOriginal(c)
  if (!original.ok) return original.response

  let blockedReason: string | null
  let objectsDropped: ObjectsDropped | null = null
  let pageCount: number | null = null
  let originalPages: number | null = null
  let layout: LayoutResult | null = null
  try {
    if (format === 'hwpx') {
      const inspected = await inspectHwpxEditorSave(original.bytes, saved)
      blockedReason = inspected.blockedReason
      objectsDropped = inspected.objectsDropped
    } else {
      blockedReason = (await inspectHwpEditorSave(original.bytes, saved)).blockedReason
    }
    if (!blockedReason) {
      layout = await renderPages(saved, c.attachment.name, startedAt)
      originalPages = await originalPageCount(
        c.attachment.id,
        original.bytes,
        c.attachment.name,
        startedAt
      )
      pageCount = layout && !layout.truncated ? layout.pages.length : null
      // HWPX 는 쪽 수로 막지 않는다 — 미리보기에 "원본 n쪽 → m쪽"으로 보여 준다(docs/18 §2)
      if (format === 'hwp' && pageCountBlocked(originalPages, pageCount)) {
        blockedReason = BLOCKED_MESSAGE.pages
      } else if (!layout && originalPages !== null) blockedReason = BLOCKED_MESSAGE.preview
    }
  } catch (e) {
    return docEditErrorResponse(e, 'api/files/drafts/verify')
  }

  const blocked = blockedReason !== null
  const meta: DraftMeta = {
    kind: 'doc-edit',
    mode: 'hwp-editor',
    sourceAttachmentId: c.attachment.id,
    format,
    blocked,
    applied: 0,
    skipped: 0,
  }
  try {
    if (!(await setPendingDraftMeta(row.id, c.user.id, meta))) return docEditFail('not_found')
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
    format,
    applied: 0,
    skipped: [],
    unmatched: [],
    verification: null,
    warnings: [],
    pageCount,
    originalPageCount: originalPages,
    previewAvailable,
    blocked,
    blockedReason,
    ...(objectsDropped ? { objectsDropped } : {}),
  }
  return NextResponse.json(outcome, { headers: DOC_EDIT_PRIVATE_HEADERS })
}
