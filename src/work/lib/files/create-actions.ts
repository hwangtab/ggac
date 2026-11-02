'use server'

import { getPendingUpload } from '@/db/queries/work/files'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { commitFileMessage, findOwnMessageAttachment } from '@/db/queries/work/versions'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  canPostRestricted,
  isWorkAdmin,
  loadChannelAccess,
  viewerOf,
} from '@/lib/server/boardWorkChannelAuth'
import { logAudit } from '@work/lib/audit/log'
import { dbFailure, fail, invalid, ok, type ActionResult } from '@work/lib/channels/action-result'
import { conversationBasePath } from '@work/lib/tabs/paths'
import { checkCreateAccess } from './create-access-check'
import {
  copiedDocumentBody,
  copyAsNewDocumentSchema,
  createDeniedMessage,
  createDocumentSchema,
  createMimeFor,
  createdDocumentBody,
  fileExtOf,
  normalizeCreateFileName,
  normalizeCreateFolder,
  normalizeFileNameWithExt,
  type CopyAsNewDocumentOutcome,
  type CreateDocumentOutcome,
} from './create-rules'
import { discardDraftPreview } from './doc-edit-draft'
import { isDraftMeta } from './doc-edit-types'
import { loadEditContext, NOT_FOUND as FILE_NOT_FOUND } from './edit-context'
import { buildUploadPath, isSafeAttachmentPath, thumbPathOf } from './paths'
import { preparePromotion, PromoteRejected } from './promote'
import { copyObject, removeObjects, StorageUnconfiguredError } from './storage'
import { STORAGE_RETRY_MESSAGE, StorageUnavailableError } from './storage-errors'
import { extensionOf } from './version-rules'

/**
 * 새 문서 만들기(docs/16 §4)·사본으로 새 문서(§6) — 원본 kosmart-work `lib/files/create-actions.ts`와 같은 이름·입력·반환 모양.
 * 편집기에서 처음 저장할 때 호출된다. 파일은 이 순간 처음 생긴다(v1).
 * 한글 문서(HWPX, docs/18)는 임시 업로드가 서버 검증(`new-drafts/…/verify`)을 거친 `draft_meta { newDocument:true, format:'hwpx' }` 를
 * 가져야 하고, 막힌 저장본·다른 경로의 파일은 여기서 다시 거부한다.
 * 뼈대: 가드 → zod → 권한(멤버·게스트·보관·공지 채널, create-access-check) → pending 소유 검사 → 게시물 + 첨부(한 트랜잭션,
 * 클라이언트가 만든 게시물 id 로 멱등). 원본은 게시물을 먼저 쓰고 실패하면 지웠다 — 여기서는 함께 생기거나 함께 안 생긴다.
 */

export async function createDocument(input: unknown): Promise<ActionResult<CreateDocumentOutcome>> {
  const s = await requireWorkStaff()
  const parsed = createDocumentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const { user, staff } = s

  const accessCheck = await checkCreateAccess(s, v.channelId, v.parentId)
  if (!accessCheck.ok || !accessCheck.channel) {
    return accessCheck.reason === 'server'
      ? dbFailure('create-doc:access', new Error('access check failed'))
      : fail(accessCheck.message ?? '채널을 찾을 수 없거나 권한이 없습니다.')
  }
  const channel = accessCheck.channel

  const fileName = normalizeCreateFileName(v.fileName, v.type)
  if (!fileName) return fail('파일 이름을 입력해 주세요.')
  const folderPath = normalizeCreateFolder(v.folderPath)
  if (v.folderPath && !folderPath) return fail('폴더 경로가 올바르지 않습니다.')

  let row: Awaited<ReturnType<typeof getPendingUpload>>
  try {
    row = await getPendingUpload(v.uploadId, user.id)
  } catch (e) {
    return dbFailure('create-doc:pending', e)
  }
  const isHwpx = v.type === 'hwpx'
  const base = conversationBasePath(channel)
  const viewer = viewerOf(s)
  const access = await loadChannelAccess(viewer, channel.id)
  const restricted = access ? canPostRestricted(viewer, access) : false

  if (!row || row.channelId !== channel.id || (!isHwpx && row.draftMeta !== null)) {
    // 같은 게시물 id 로 이미 만들었다(재시도) — 그 결과를 돌려준다
    const prior = await findExisting(v.messageId, user.id, channel.id)
    if (prior)
      return ok({
        attachmentId: prior.id,
        fileName: prior.name,
        versionNo: 1,
        conversationPath: base,
      })
    return fail('올린 파일을 찾을 수 없습니다. 다시 저장해 주세요.')
  }
  if (isHwpx) {
    const meta = row.draftMeta
    if (
      !isDraftMeta(meta) ||
      meta.mode !== 'hwp-editor' ||
      meta.newDocument !== true ||
      meta.format !== 'hwpx'
    ) {
      return fail('저장본을 검증하지 못했습니다. 다시 저장해 주세요.')
    }
    if (meta.blocked) {
      return fail('이 저장본은 앱에서 저장할 수 없습니다. 다시 만들어 주세요.')
    }
  }
  if (extensionOf(row.name) !== v.type || row.mime !== createMimeFor(v.type)) {
    return fail('파일 형식이 맞지 않아 저장하지 않았습니다.')
  }

  let prepared: Awaited<ReturnType<typeof preparePromotion>>
  try {
    prepared = await preparePromotion(row)
  } catch (e) {
    if (e instanceof StorageUnavailableError || e instanceof StorageUnconfiguredError) {
      return fail(STORAGE_RETRY_MESSAGE)
    }
    console.error('[create-doc:prepare]', e instanceof Error ? e.name : 'unknown')
    return fail(
      e instanceof PromoteRejected
        ? e.message
        : '새 문서를 저장하지 못했습니다. 잠시 후 다시 저장해 주세요.'
    )
  }

  let saved: Awaited<ReturnType<typeof commitFileMessage>>
  try {
    saved = await commitFileMessage({
      actorId: user.id,
      message: {
        id: v.messageId,
        channelId: channel.id,
        parentId: v.parentId ?? null,
        canPostRestricted: restricted,
        body: () => createdDocumentBody(staff.display_name, fileName, v.type),
      },
      source: {
        kind: 'pending',
        uploadId: row.id,
        allowDraft: isHwpx,
        size: prepared.size,
        width: prepared.width,
        height: prepared.height,
        name: fileName,
      },
      folderPath,
    })
  } catch (e) {
    await prepared.rollback()
    console.error('[create-doc:commit]', e instanceof Error ? e.name : 'unknown')
    if (isWorkWriteError(e, 'owners_only')) return fail('이 채널은 소유자만 글을 올릴 수 있습니다.')
    if (isWorkWriteError(e, 'archived')) return fail('보관된 채널에는 쓸 수 없습니다.')
    return fail('새 문서를 저장하지 못했습니다. 잠시 후 다시 저장해 주세요.')
  }
  if (saved.status === 'duplicate') {
    const dup = saved as Extract<typeof saved, { status: 'duplicate' }>
    if (!dup.attachment) return fail('새 문서를 저장하지 못했습니다. 잠시 후 다시 저장해 주세요.')
    return ok({
      attachmentId: dup.attachment.id,
      fileName: dup.attachment.name,
      versionNo: 1,
      conversationPath: base,
    })
  }
  const created = saved as Extract<typeof saved, { status: 'created' }>

  if (isHwpx) await discardDraftPreview(row.id)
  await logAudit(
    user.id,
    'file.app_create',
    { type: 'attachment', id: created.attachment.id },
    { channel_id: channel.id, type: v.type }
  )
  return ok({
    attachmentId: created.attachment.id,
    fileName: created.attachment.name,
    versionNo: 1,
    conversationPath: base,
  })
}

/** 같은 게시물 id 로 이미 만들어진 내 문서(멱등) — 내 게시물·같은 채널일 때만 */
async function findExisting(
  messageId: string,
  userId: string,
  channelId: string
): Promise<{ id: string; name: string } | null> {
  try {
    return await findOwnMessageAttachment(messageId, userId, channelId)
  } catch (e) {
    console.error('[create-doc:findExisting]', e)
    return null
  }
}

/**
 * 사본으로 새 문서(docs/16 §6) — 원본 파일의 객체를 새 키로 복사해 같은 채널·같은 폴더에 새 v1(계보 없음)로 올린다.
 * 모든 형식. 권한 = 편집 권한(edit-context) + 최상위 게시 규칙(createDeniedMessage, 공지 채널은 owner·관리자만).
 * messageId 는 클라이언트가 만든 uuid — 같은 id 로 재시도하면 기존 결과를 돌려준다. 실패하면 복사본을 지운다.
 */
export async function copyAsNewDocument(
  input: unknown
): Promise<ActionResult<CopyAsNewDocumentOutcome>> {
  const s = await requireWorkStaff()
  const parsed = copyAsNewDocumentSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const { user, staff } = s
  const viewer = viewerOf(s)

  const ctx = await loadEditContext(s, v.sourceAttachmentId)
  if (!ctx.ok) return fail(ctx.error)
  const { attachment: src, channel, access } = ctx.data

  const denied = createDeniedMessage({
    isGuest: staff.role === 'guest',
    isMember: access.isMember,
    archived: access.archived,
    postPolicy: channel.post_policy,
    isChannelOwner: access.isOwner,
    isAdmin: isWorkAdmin(viewer),
    inThread: false,
  })
  if (denied) return fail(denied)

  if (!isSafeAttachmentPath(src.bucket_path)) {
    console.error('[copy-doc] 안전하지 않은 첨부 경로 — 중단:', src.id)
    return fail(FILE_NOT_FOUND)
  }
  const fileName = normalizeFileNameWithExt(v.fileName, fileExtOf(src.name))
  if (!fileName) return fail('파일 이름을 입력해 주세요.')
  const base = conversationBasePath(channel)
  const restricted = canPostRestricted(viewer, access)

  const prior = await findExisting(v.messageId, user.id, channel.id)
  if (prior) return ok({ attachmentId: prior.id, fileName: prior.name, conversationPath: base })

  const path = buildUploadPath(crypto.randomUUID(), fileName)
  const withThumb = src.mime.startsWith('image/')
  try {
    await copyObject(src.bucket_path, path)
  } catch (e) {
    console.error('[copy-doc:copy]', e)
    return fail('파일을 복사하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  if (withThumb) {
    await copyObject(thumbPathOf(src.bucket_path), thumbPathOf(path)).catch(() => undefined)
  }

  let saved: Awaited<ReturnType<typeof commitFileMessage>>
  try {
    saved = await commitFileMessage({
      actorId: user.id,
      message: {
        id: v.messageId,
        channelId: channel.id,
        parentId: null,
        canPostRestricted: restricted,
        body: () => copiedDocumentBody(staff.display_name, src.name, fileName),
      },
      source: {
        kind: 'copy',
        blobPath: path,
        name: fileName,
        mime: src.mime,
        size: src.size,
        width: src.width,
        height: src.height,
      },
      folderPath: src.folder_path,
    })
  } catch (e) {
    await removeObjects(withThumb ? [path, thumbPathOf(path)] : [path]).catch(() => undefined)
    if (isWorkWriteError(e, 'owners_only')) return fail('이 채널은 소유자만 글을 올릴 수 있습니다.')
    return dbFailure('copy-doc:insert', e)
  }
  if (saved.status === 'duplicate') {
    await removeObjects(withThumb ? [path, thumbPathOf(path)] : [path]).catch(() => undefined)
    const dup = saved as Extract<typeof saved, { status: 'duplicate' }>
    if (!dup.attachment) return fail('파일을 복사하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    return ok({
      attachmentId: dup.attachment.id,
      fileName: dup.attachment.name,
      conversationPath: base,
    })
  }
  const created = saved as Extract<typeof saved, { status: 'created' }>
  await logAudit(
    user.id,
    'file.app_copy',
    { type: 'attachment', id: created.attachment.id },
    { channel_id: channel.id, source: src.id }
  )
  return ok({
    attachmentId: created.attachment.id,
    fileName: created.attachment.name,
    conversationPath: base,
  })
}
