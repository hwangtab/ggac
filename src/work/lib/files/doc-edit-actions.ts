'use server'

import { isWorkWriteError } from '@/db/queries/work/_shared'
import { commitFileMessage } from '@/db/queries/work/versions'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { canPostRestricted, isWorkAdmin, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { logAudit } from '@work/lib/audit/log'
import { dbFailure, fail, invalid, ok, type ActionResult } from '@work/lib/channels/action-result'
import { conversationBasePath } from '@work/lib/tabs/paths'
import { discardDraftPreview, discardDraftUpload, getMyDraft } from './doc-edit-draft'
import {
  discardDraftSchema,
  editedFileBody,
  filledFileBody,
  saveDraftNewFileSchema,
  type SaveDraftOutcome,
} from './doc-edit-types'
import { loadEditContext } from './edit-context'
import { displayFileName } from './paths'
import { preparePromotion, PromoteRejected } from './promote'
import { StorageUnconfiguredError } from './storage'
import { STORAGE_RETRY_MESSAGE, StorageUnavailableError } from './storage-errors'
import { extensionOf, shouldPostTopLevel } from './version-rules'
import { scheduleTextExtraction } from './extract-schedule'

/**
 * 문서 편집(HWP 양식 채우기·문구 고치기, docs/10 §3-3) 저장 액션 — 원본 kosmart-work `lib/files/doc-edit-actions.ts`와
 * 같은 이름·입력·반환 모양. 초안은 Route Handler(`/api/board-room/work/files/<id>/draft`)가 만든다.
 * 새 버전으로 저장은 `saveFileVersion({ …, source: 'app-edit' })` 를 그대로 쓴다 — 여기는 "새 파일로 저장"과 초안 버리기.
 * 가드(requireWorkStaff) → zod → 편집 권한(edit-context) → 초안 소유·막힘 검사 → 게시물 + 첨부(한 트랜잭션, 쿼리 층).
 * 문서 내용·입력 값은 로그·감사 로그에 남기지 않는다(모드·개수만).
 */

/** 새 파일 이름 — 원본과 같은 확장자로 맞춘다(초안 바이트는 원본과 같은 형식이다) */
function withSourceExtension(fileName: string, sourceName: string): string {
  const name = displayFileName(fileName)
  const ext = extensionOf(sourceName)
  if (!ext) return name
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`
}

/**
 * 채우거나 고친 초안을 **새 파일**(v1)로 저장한다. 원본 게시물과 같은 채널·같은 폴더에 최상위 게시물로 올라가며,
 * 공지 채널(post_policy='owners')이고 owner·관리자가 아니면 원본 게시물의 답글로 내린다(shouldPostTopLevel 재사용).
 */
export async function saveDraftAsNewFile(input: unknown): Promise<ActionResult<SaveDraftOutcome>> {
  const s = await requireWorkStaff()
  const parsed = saveDraftNewFileSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const { user, staff } = s
  const viewer = viewerOf(s)

  // ① 원본 읽기 + 편집 권한
  const ctx = await loadEditContext(s, v.sourceAttachmentId)
  if (!ctx.ok) return fail(ctx.error)
  const { attachment: src, channel, access } = ctx.data

  // ② 초안: 내 것·같은 원본·같은 채널·막히지 않음 (서버가 다시 검사한다)
  let draft: Awaited<ReturnType<typeof getMyDraft>>
  try {
    draft = await getMyDraft(user.id, v.uploadId)
  } catch (e) {
    return dbFailure('doc-edit:draft', e)
  }
  if (!draft || draft.row.channelId !== src.channel_id) {
    return fail('초안을 찾을 수 없습니다. 미리보기를 다시 만들어 주세요.')
  }
  if (draft.meta.newDocument) {
    return fail('새 문서 초안은 새 파일로 저장할 수 없습니다. 새 문서로 저장해 주세요.')
  }
  if (draft.meta.sourceAttachmentId !== src.id) {
    return fail('이 초안은 다른 파일에서 만든 것입니다. 다시 만들어 주세요.')
  }
  if (draft.meta.blocked) {
    return fail('이 초안은 앱에서 저장할 수 없습니다. 내 PC에서 수정을 써 주세요.')
  }
  // HWP 앱 안 편집(docs/12)의 저장본은 새 버전으로만 저장한다
  if (draft.meta.mode === 'hwp-editor') {
    return fail('이 저장본은 새 파일로 저장할 수 없습니다. 새 버전으로 저장해 주세요.')
  }

  // ③ 게시물(최상위 — 새 자료라 채널에 보이는 게 맞다. 공지 채널의 일반 멤버는 원본 게시물의 답글)
  const topLevel = shouldPostTopLevel({
    announce: true,
    postPolicy: channel.post_policy,
    isChannelOwner: access.isOwner,
    isAdmin: isWorkAdmin(viewer),
  })
  const fileName = withSourceExtension(v.fileName, src.name)
  const bodyOf = draft.meta.mode === 'fill' ? filledFileBody : editedFileBody

  let prepared: Awaited<ReturnType<typeof preparePromotion>>
  try {
    prepared = await preparePromotion(draft.row)
  } catch (e) {
    if (e instanceof StorageUnavailableError || e instanceof StorageUnconfiguredError) {
      return fail(STORAGE_RETRY_MESSAGE)
    }
    await discardDraftUpload(draft.row)
    return fail(
      e instanceof PromoteRejected
        ? e.message
        : '새 파일을 저장하지 못했습니다. 미리보기를 다시 만들어 주세요.'
    )
  }

  // ④ 게시물 + 첨부(v1 — 계보 없음, 폴더는 원본 것)를 한 트랜잭션에서
  let saved: Awaited<ReturnType<typeof commitFileMessage>>
  try {
    saved = await commitFileMessage({
      actorId: user.id,
      message: {
        id: crypto.randomUUID(),
        channelId: channel.id,
        parentId: topLevel ? null : (src.message_parent_id ?? src.message_id),
        canPostRestricted: canPostRestricted(viewer, access),
        body: () => bodyOf(staff.display_name, src.name, fileName),
      },
      source: {
        kind: 'pending',
        uploadId: draft.row.id,
        allowDraft: true,
        size: prepared.size,
        width: prepared.width,
        height: prepared.height,
        name: fileName,
      },
      folderPath: src.folder_path,
    })
  } catch (e) {
    await prepared.rollback()
    console.error('[doc-edit:commit]', e instanceof Error ? e.name : 'unknown')
    if (isWorkWriteError(e, 'archived')) return fail('보관된 채널에는 쓸 수 없습니다.')
    return fail('새 파일을 저장하지 못했습니다. 미리보기를 다시 만들어 주세요.')
  }
  const created = saved as Extract<typeof saved, { status: 'created' }>

  // 미리보기 캐시를 치운다(객체는 이제 첨부다 — 지우지 않는다. 실패해도 저장은 성공)
  await discardDraftPreview(draft.row.id)
  await logAudit(
    user.id,
    'file.app_edit',
    { type: 'attachment', id: created.attachment.id },
    {
      channel_id: channel.id,
      source: src.id,
      mode: draft.meta.mode,
      applied: draft.meta.applied,
      skipped: draft.meta.skipped,
      new_file: true,
    }
  )

  scheduleTextExtraction([created.attachment.id])
  return ok({
    attachmentId: created.attachment.id,
    fileName: created.attachment.name,
    conversationPath: conversationBasePath(channel),
  })
}

/** 초안을 버린다(대화상자를 닫을 때). 내 초안만. 이미 없으면 성공 */
export async function discardDraft(input: unknown): Promise<ActionResult> {
  const { user } = await requireWorkStaff()
  const parsed = discardDraftSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    const draft = await getMyDraft(user.id, parsed.data.uploadId)
    if (draft) await discardDraftUpload(draft.row)
  } catch (e) {
    return dbFailure('doc-edit:discard', e)
  }
  return ok(undefined)
}
