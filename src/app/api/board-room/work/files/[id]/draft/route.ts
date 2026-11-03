import { NextResponse, type NextRequest } from 'next/server'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { buildFilledDraft, buildPatchedDraft, type BuiltDraft } from '@work/lib/files/doc-edit'
import {
  discardDraftUpload,
  getMyDraft,
  saveDraftUpload,
  storeDraftLayout,
} from '@work/lib/files/doc-edit-draft'
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
  DRAFT_PREVIEW_MAX_PAGES,
  draftRequestSchema,
  pageCountBlocked,
  type DraftOutcome,
} from '@work/lib/files/doc-edit-types'
import { originalPageCount, renderPages } from '@work/lib/files/doc-edit-pages'
import { DOC_EDIT_MAX_BODY_BYTES } from '@work/lib/files/render-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// 초안 만들기(45초) + 쪽 수·미리보기 렌더 + 저장
export const maxDuration = 60

/**
 * POST /api/board-room/work/files/<attachment id>/draft — 초안 만들기(docs/10 §3-1). 원본 kosmart-work `api/files/[id]/draft`.
 * 권한: requireBoardMember → 업무툴 역할 → 읽기(아니면 404) → 편집 권한(아니면 403) → 사용량(WORK_DOC_EDIT_DRAFT).
 * 본문(JSON): `{ mode:'fill', values }` | `{ mode:'patch', blocks, baseHash }` (+ `previousUploadId`).
 * 초안 파일은 응답에 싣지 않고 임시 업로드(pending)로 저장해 `uploadId` 만 돌려준다(함수 본문 4.5MB 한도).
 * 막힌 초안(blocked)도 미리보기용으로 만들되, 저장 액션이 draft_meta 로 서버에서 다시 거부한다.
 * 입력 값·문서 내용은 로그·감사 로그에 남기지 않는다.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth

  const startedAt = Date.now()
  const { id } = await ctx.params
  const opened = await openEditable(auth.user.id, id)
  if (!opened.ok) return opened.response
  const c = opened.ctx

  const limited = await hitDocEditLimit(c.user.id, 'draft')
  if (limited) return limited

  // 본문은 JSON 만 받는다(form 전송 등 다른 형식은 415)
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return docEditFail('unsupported', 'JSON 요청만 받을 수 있습니다.')
  }

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return docEditFail('bad_request')
  }
  if (Buffer.byteLength(raw, 'utf8') > DOC_EDIT_MAX_BODY_BYTES) {
    return docEditFail('too_large', '입력이 너무 큽니다.')
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return docEditFail('bad_request')
  }
  const parsed = draftRequestSchema.safeParse(json)
  if (!parsed.success) return docEditFail('bad_request')
  const request = parsed.data

  const original = await readOriginal(c)
  if (!original.ok) return original.response

  let built: BuiltDraft
  try {
    built =
      request.mode === 'fill'
        ? await buildFilledDraft(original.bytes, request.values)
        : await buildPatchedDraft(original.bytes, request.blocks, request.baseHash)
  } catch (e) {
    return docEditErrorResponse(e, 'api/files/draft')
  }

  // 쪽 수·미리보기 — 실패해도 초안은 유효하다(미리보기만 못 본다). 단 원본은 그려지는데 초안만 못 그리면 막는다.
  const draftLayout = await renderPages(built.data, c.attachment.name, startedAt)
  const originalPages = await originalPageCount(
    c.attachment.id,
    original.bytes,
    c.attachment.name,
    startedAt
  )
  const draftPages = draftLayout && !draftLayout.truncated ? draftLayout.pages.length : null

  let blocked = built.blocked
  let blockedReason = built.blockedReason
  if (!blocked && pageCountBlocked(originalPages, draftPages)) {
    blocked = true
    blockedReason = BLOCKED_MESSAGE.pages
  }
  if (!blocked && !draftLayout && originalPages !== null) {
    blocked = true
    blockedReason = BLOCKED_MESSAGE.preview
  }

  try {
    if (request.previousUploadId) {
      const prev = await getMyDraft(c.user.id, request.previousUploadId)
      if (prev && prev.meta.sourceAttachmentId === c.attachment.id) {
        await discardDraftUpload(prev.row)
      }
    }

    const saved = await saveDraftUpload({
      userId: c.user.id,
      channelId: c.channel.id,
      name: c.attachment.name,
      data: built.data,
      meta: {
        kind: 'doc-edit',
        mode: request.mode,
        sourceAttachmentId: c.attachment.id,
        blocked,
        applied: built.applied,
        skipped: built.skipped.length,
      },
    })
    if ('error' in saved) {
      return docEditFail(
        'rate_limited',
        '저장하지 않은 초안·첨부가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.'
      )
    }
    const previewAvailable = draftLayout
      ? await storeDraftLayout(saved.uploadId, draftLayout)
      : false

    const outcome: DraftOutcome = {
      uploadId: saved.uploadId,
      mode: request.mode,
      format: built.format,
      applied: built.applied,
      skipped: built.skipped,
      unmatched: built.unmatched,
      verification: built.verification,
      warnings: built.warnings,
      pageCount: draftPages,
      originalPageCount: originalPages,
      previewAvailable,
      previewPages: draftLayout ? Math.min(draftLayout.pages.length, DRAFT_PREVIEW_MAX_PAGES) : 0,
      blocked,
      blockedReason,
    }
    return NextResponse.json(outcome, { headers: DOC_EDIT_PRIVATE_HEADERS })
  } catch (e) {
    return docEditErrorResponse(e, 'api/files/draft:save')
  }
}
