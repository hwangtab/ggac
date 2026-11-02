'use server'

import { getPendingUpload } from '@/db/queries/work/files'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import {
  acquireCheckout,
  clearCheckout,
  clearFinalVersion,
  commitFileMessage,
  getAttachmentForEdit,
  getFileLineage,
  listLineageVersions,
  listMyCheckoutRecords,
  resolveLatestLiveVersionParentId,
  resolveVersionParentId,
  setFinalVersion,
  type AttachmentEditRecord,
  type LineageVersionRecord,
} from '@/db/queries/work/versions'
import { requireWorkStaff, type WorkGuardContext } from '@/lib/server/boardWorkAuth'
import {
  canPostRestricted,
  isWorkAdmin,
  loadChannelAccess,
  readableChannelIds,
  viewerOf,
  type ChannelAccessDecision,
} from '@/lib/server/boardWorkChannelAuth'
import { logAudit } from '@work/lib/audit/log'
import {
  dbFailure,
  fail,
  FORBIDDEN_MESSAGE,
  invalid,
  ok,
  type ActionResult,
} from '@work/lib/channels/action-result'
import { conversationBasePath } from '@work/lib/tabs/paths'
import { discardDraftPreview } from './doc-edit-draft'
import { loadEditContext, NOT_FOUND, type EditContext } from './edit-context'
import {
  APP_EDIT_SUFFIX,
  HWP_EDITOR_SUFFIX,
  HWPX_EDITOR_SUFFIX,
  OFFICE_EDIT_SUFFIX,
  isDraftMeta,
} from './doc-edit-types'
import { buildUploadPath, isSafeAttachmentPath, thumbPathOf } from './paths'
import { discardPending, preparePromotion, PromoteRejected } from './promote'
import { STORAGE_RETRY_MESSAGE, StorageUnavailableError } from './storage-errors'
import { copyObject, removeObjects, StorageUnconfiguredError } from './storage'
import {
  checkoutSchema,
  listVersionsSchema,
  markFinalSchema,
  releaseSchema,
  restoreVersionSchema,
  saveVersionSchema,
  type CheckoutOutcome,
  type MyCheckoutItem,
  type SaveVersionOutcome,
  type VersionConflictInfo,
} from './version-schema'
import {
  canEditFile,
  checkoutDeadline,
  editDeniedMessage,
  isCheckoutActive,
  lineageRootId,
  pickLatest,
  shouldPostTopLevel,
  versionRestoredBody,
  versionUploadedBody,
  type FileCheckout,
  type FileVersionState,
} from './version-rules'

/**
 * 문서 버전 서버 액션 — 원본 kosmart-work `lib/files/version-actions.ts`(0032, docs/09 §2)와 같은 이름·입력·반환 모양.
 * 가드(requireWorkStaff) → zod → 편집 권한 판정 → 쓰기.
 *
 * 원본은 계보·게시물·버전 첨부를 service_role 로 쓰고 권한(편집 권한 = 채널 멤버인 내부 구성원, 보관 채널·삭제된 게시물
 * 불가)을 여기서 직접 판정했다. ggac 도 같다 — RLS 가 없으므로 읽기 판정(`canRead`)까지 여기서 한다.
 * 계보 정합성(같은 채널·번호 계산·최신 검사·경합·is_latest)은 쿼리 층(`src/db/queries/work/versions.ts`)이
 * 한 트랜잭션에서 지킨다. 원본은 게시물을 먼저 쓰고 승격이 실패하면 지웠지만, 여기서는 게시물과 첨부가 함께 생기거나
 * 함께 안 생긴다 — 그래서 원본의 removeMessage·fixVersionMessageBody 가 필요 없다(본문의 번호도 실제 번호로 쓴다).
 *
 * 버전 게시물은 같은 트랜잭션에서 채널 rev 를 올린다 — 다른 사람 화면은 폴링(§6)으로 새 게시물·첨부를 다시 읽는다.
 * 문서 본문 추출(scheduleTextExtraction)은 4단계라 부르지 않는다. 감사 기록은 구조화 로그(`logAudit`)다.
 */

type Staffed = WorkGuardContext

function toConflictInfo(row: LineageVersionRecord): VersionConflictInfo {
  return {
    id: row.id,
    versionNo: row.version_no,
    name: row.name,
    uploaderName: row.uploader_name,
    createdAt: row.created_at,
  }
}

/** 원본 pickLatest 는 is_latest·deleted 를 본다 — 쿼리 행을 그 모양으로 */
function lineageRows(rows: LineageVersionRecord[]) {
  return rows.map(r => ({ ...r, deleted: r.message_deleted }))
}

const ANNOUNCE_ONLY_BLOCKED_MESSAGE =
  '공지 채널에서는 원래 게시물이 삭제되어 새 버전을 올릴 수 없습니다. 채널 관리자에게 요청해 주세요.'

/**
 * 버전 게시물의 부모(원본 postVersionMessage 의 판정 부분). 공지 채널(post_policy='owners')에서 owner·관리자가 아니면
 * 반드시 답글이어야 한다 — 부모를 못 찾으면 최상위로 내리지 않고 거절한다.
 */
async function decideVersionParent(
  s: Staffed,
  ctx: EditContext,
  announce: boolean,
  lineageIds: string[]
): Promise<{ parentId: string | null; canPostRestricted: boolean } | { error: string }> {
  const ownersOnly = ctx.channel.post_policy === 'owners'
  const viewer = viewerOf(s)
  const isChannelOwner = ctx.access.isOwner
  const isAdmin = isWorkAdmin(viewer)
  const topLevel = shouldPostTopLevel({
    announce,
    postPolicy: ctx.channel.post_policy,
    isChannelOwner,
    isAdmin,
  })
  let parentId = topLevel ? null : await resolveVersionParentId(ctx.rootId)
  if (!topLevel && parentId === null && ownersOnly && !isChannelOwner && !isAdmin) {
    parentId = await resolveLatestLiveVersionParentId(lineageIds)
    if (parentId === null) return { error: ANNOUNCE_ONLY_BLOCKED_MESSAGE }
  }
  return { parentId, canPostRestricted: canPostRestricted(viewer, ctx.access) }
}

/** 게시물 쓰기 실패(쿼리 층 오류) → 사용자 문구 */
function commitFailure(where: string, e: unknown): ActionResult<never> {
  if (isWorkWriteError(e, 'archived')) return fail('보관된 채널에는 쓸 수 없습니다.')
  if (isWorkWriteError(e, 'owners_only')) return fail('이 채널은 소유자만 글을 올릴 수 있습니다.')
  if (isWorkWriteError(e, 'forbidden')) return fail('참여한 채널에서만 글을 쓸 수 있습니다.')
  if (isWorkWriteError(e, 'not_found'))
    return fail('올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
  return dbFailure(where, e)
}

/**
 * "내 PC에서 수정"·앱 편집 시작 — 계보 행에 수정 중 = 나·지금·+8시간을 기록한다. 남이 유효하게 잡고 있으면
 * `{ status: 'held' }` 로 알리고, force 로 다시 부르면 덮어쓴다(잠금은 안내용, 저장을 막지 않는다).
 */
export async function checkoutFile(input: unknown): Promise<ActionResult<CheckoutOutcome>> {
  const s = await requireWorkStaff()
  const parsed = checkoutSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const ctx = await loadEditContext(s, parsed.data.attachmentId)
  if (!ctx.ok) return fail(ctx.error)
  const { rootId, channel } = ctx.data

  const now = new Date()
  const until = checkoutDeadline(now)
  let result: Awaited<ReturnType<typeof acquireCheckout>>
  try {
    result = await acquireCheckout({
      rootId,
      channelId: channel.id,
      userId: s.user.id,
      now,
      until,
      force: parsed.data.force === true,
    })
  } catch (e) {
    return dbFailure('versions:checkout', e)
  }
  if (result.status === 'held') {
    const held = result as Extract<typeof result, { status: 'held' }>
    return ok({
      status: 'held',
      heldBy: { userId: held.holderId, userName: held.holderName },
      since: held.since,
    })
  }
  const acquired = result as Extract<typeof result, { status: 'acquired' }>
  if (acquired.previousHolder && acquired.previousHolder !== s.user.id) {
    await logAudit(
      s.user.id,
      'file.checkout_override',
      { type: 'attachment', id: rootId },
      { channel_id: channel.id, previous_holder: acquired.previousHolder }
    )
  }
  return ok({ status: 'ok', until: until.toISOString() })
}

/** 내 수정 중 해제(관리자는 남의 것도). 읽을 수 있는 파일이면 멤버 여부는 묻지 않는다 */
export async function releaseCheckout(input: unknown): Promise<ActionResult> {
  const s = await requireWorkStaff()
  const parsed = releaseSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const viewer = viewerOf(s)

  let target: AttachmentEditRecord | null
  let canRead = false
  try {
    // 원본은 기준 게시물이 지워져도 계보 RPC 로 찾아 해제했다 — 여기서는 지워진 게시물의 첨부도 읽을 수 있다
    target = await getAttachmentForEdit(parsed.data.attachmentId)
    canRead = target ? (await readableChannelIds(viewer)).has(target.channel_id) : false
  } catch (e) {
    return dbFailure('versions:release:read', e)
  }
  if (!target || !canRead) return fail(NOT_FOUND)
  const rootId = lineageRootId(target)

  let lineage: Awaited<ReturnType<typeof getFileLineage>>
  try {
    lineage = await getFileLineage(rootId)
  } catch (e) {
    return dbFailure('versions:release:lineage', e)
  }
  if (!lineage?.checkout_user_id) return ok(undefined)

  const mine = lineage.checkout_user_id === s.user.id
  // 화면을 떠나며 부르는 정리 해제 — 남의 잠금(관리자 포함)은 건드리지 않는다
  if (!mine && parsed.data.onlyMine) return ok(undefined)
  if (!mine && !isWorkAdmin(viewer)) return fail(FORBIDDEN_MESSAGE)

  try {
    await clearCheckout(rootId, lineage.checkout_user_id)
  } catch (e) {
    return dbFailure('versions:release:update', e)
  }
  if (!mine) {
    await logAudit(
      s.user.id,
      'file.checkout_override',
      { type: 'attachment', id: rootId },
      { channel_id: target.channel_id, previous_holder: lineage.checkout_user_id, released: true }
    )
  }
  return ok(undefined)
}

/**
 * 수정본 저장 — 새 버전 확정(docs/09 §2).
 * ① base 가 계보의 현재 최신이 아니면 force 없이는 conflict ② 임시 업로드 검사(소유·채널·초안 메타) ③ 저장소 확인 →
 * 게시물 + 버전 첨부(previous = 현재 최신)를 한 트랜잭션에서 ④ 그 사이 다른 사람이 먼저 저장했으면(경합) conflict
 * ⑤ 내 수정 중 해제(같은 트랜잭션).
 */
export async function saveFileVersion(input: unknown): Promise<ActionResult<SaveVersionOutcome>> {
  const s = await requireWorkStaff()
  const parsed = saveVersionSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data

  const ctx = await loadEditContext(s, v.baseAttachmentId)
  if (!ctx.ok) return fail(ctx.error)
  const { channel } = ctx.data
  const readable = new Set([channel.id])

  let lineage: LineageVersionRecord[]
  try {
    lineage = await listLineageVersions(ctx.data.attachment.id, readable)
  } catch (e) {
    return dbFailure('versions:save:lineage', e)
  }
  const latest = pickLatest(lineageRows(lineage))
  if (!latest) return fail(NOT_FOUND)

  if (latest.id !== v.baseAttachmentId && !v.force) {
    return ok({ status: 'conflict', latest: toConflictInfo(latest), uploadConsumed: false })
  }

  let pending: Awaited<ReturnType<typeof getPendingUpload>>
  try {
    pending = await getPendingUpload(v.uploadId, s.user.id)
  } catch (e) {
    return dbFailure('versions:save:pending', e)
  }
  if (!pending || pending.channelId !== channel.id) {
    return fail('올린 파일을 찾을 수 없습니다. 다시 올려 주세요.')
  }

  // 앱 문서 편집 초안(docs/10): 막힌 초안·다른 원본의 초안은 서버에서 다시 거부한다. 출처 표시(source)를 믿지 않고 메타로 판단한다.
  const draftMeta = isDraftMeta(pending.draftMeta) ? pending.draftMeta : null
  if (draftMeta) {
    if (draftMeta.blocked) {
      return fail('이 초안은 앱에서 저장할 수 없습니다. 내 PC에서 수정을 써 주세요.')
    }
    if (draftMeta.newDocument) {
      return fail('새 문서 초안은 새 버전으로 저장할 수 없습니다. 새 문서로 저장해 주세요.')
    }
    if (draftMeta.sourceAttachmentId !== v.baseAttachmentId) {
      return fail('이 초안은 다른 파일에서 만든 것입니다. 다시 만들어 주세요.')
    }
  } else if (pending.draftMeta !== null && pending.draftMeta !== undefined) {
    // 알 수 없는 모양의 메타 — 일반 업로드로 보지 않는다
    return fail('올린 파일을 찾을 수 없습니다. 다시 만들어 주세요.')
  } else if (v.source === 'app-edit') {
    return fail('올린 파일을 찾을 수 없습니다. 다시 만들어 주세요.')
  }
  // HWP 앱 안 편집(docs/12): 서버 검증(verify)을 거친 저장본만 — 검증 없이 올린 파일을 이 출처로 저장하지 못하게 한다
  if (v.source === 'hwp-editor' && draftMeta?.mode !== 'hwp-editor') {
    return fail('저장본을 검증하지 못했습니다. 다시 저장해 주세요.')
  }
  if (draftMeta?.mode === 'hwp-editor' && v.source !== 'hwp-editor') {
    return fail('이 저장본은 앱 편집 화면에서만 저장할 수 있습니다.')
  }

  const bodyFor = (no: number) =>
    versionUploadedBody(s.staff.display_name, pending.name, no) +
    (draftMeta?.mode === 'hwp-editor'
      ? draftMeta.format === 'hwpx'
        ? HWPX_EDITOR_SUFFIX
        : HWP_EDITOR_SUFFIX
      : draftMeta
        ? APP_EDIT_SUFFIX
        : v.source === 'office-edit'
          ? OFFICE_EDIT_SUFFIX
          : '')
  const parent = await decideVersionParent(
    s,
    ctx.data,
    v.announce === true,
    lineage.filter(r => !r.message_deleted).map(r => r.id)
  )
  if ('error' in parent) return fail(parent.error)

  let prepared: Awaited<ReturnType<typeof preparePromotion>>
  try {
    prepared = await preparePromotion(pending)
  } catch (e) {
    if (e instanceof StorageUnavailableError || e instanceof StorageUnconfiguredError) {
      // 저장소 일시 오류 — 임시 파일을 지우지 않는다(다시 저장하면 이어서 쓴다)
      console.error('[versions:save:promote] 저장소 일시 오류', e)
      return fail(STORAGE_RETRY_MESSAGE)
    }
    await discardPending([pending], s.user.id)
    return fail(e instanceof PromoteRejected ? e.message : '새 버전을 저장하지 못했습니다.')
  }

  let saved: Awaited<ReturnType<typeof commitFileMessage>>
  try {
    saved = await commitFileMessage({
      actorId: s.user.id,
      message: {
        id: crypto.randomUUID(),
        channelId: channel.id,
        parentId: parent.parentId,
        canPostRestricted: parent.canPostRestricted,
        body: bodyFor,
      },
      source: {
        kind: 'pending',
        uploadId: pending.id,
        allowDraft: draftMeta !== null,
        size: prepared.size,
        width: prepared.width,
        height: prepared.height,
      },
      previousAttachmentId: latest.id,
      folderPath: latest.folder_path,
      clearOwnCheckout: true,
    })
  } catch (e) {
    await prepared.rollback()
    if (isWorkWriteError(e, 'conflict')) {
      // 그 사이 다른 사람이 먼저 저장했다 — 트랜잭션이 통째로 되돌려져 임시 업로드는 그대로다("그래도 저장"이 이어진다)
      let fresh: LineageVersionRecord | null = null
      try {
        fresh = pickLatest(lineageRows(await listLineageVersions(ctx.data.attachment.id, readable)))
      } catch (readErr) {
        console.error('[versions:save:refetch]', readErr)
      }
      return ok({
        status: 'conflict',
        latest: toConflictInfo(fresh ?? latest),
        uploadConsumed: false,
      })
    }
    return commitFailure('versions:save:commit', e)
  }
  if (saved.status !== 'created') return fail('새 버전을 저장하지 못했습니다.')
  const created = saved as Extract<typeof saved, { status: 'created' }>

  // 초안이면 미리보기 캐시도 치운다 — 못 치워도 정리 크론이 한다
  if (draftMeta) await discardDraftPreview(pending.id)
  if (draftMeta) {
    // 내용은 남기지 않는다(모드·개수만)
    await logAudit(
      s.user.id,
      'file.app_edit',
      { type: 'attachment', id: created.attachment.id },
      {
        channel_id: channel.id,
        mode: draftMeta.mode,
        applied: draftMeta.applied,
        skipped: draftMeta.skipped,
        version_no: created.attachment.version_no,
        new_file: false,
      }
    )
  }

  return ok({
    status: 'saved',
    attachmentId: created.attachment.id,
    versionNo: created.attachment.version_no,
    fileName: created.attachment.name,
    conversationPath: conversationBasePath(channel),
  })
}

/**
 * 옛 버전으로 되돌리기 — 그 버전의 객체를 새 키로 복사해 새 최신 버전을 만든다(이력은 지우지 않는다).
 */
export async function restoreFileVersion(
  input: unknown
): Promise<ActionResult<{ attachmentId: string; versionNo: number }>> {
  const s = await requireWorkStaff()
  const parsed = restoreVersionSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data

  const ctx = await loadEditContext(s, v.versionAttachmentId)
  if (!ctx.ok) return fail(ctx.error)
  const { channel, attachment: source } = ctx.data
  if (!isSafeAttachmentPath(source.bucket_path)) {
    console.error('[versions:restore] 안전하지 않은 첨부 경로 — 중단:', source.id)
    return fail(NOT_FOUND)
  }

  let lineage: LineageVersionRecord[]
  try {
    lineage = await listLineageVersions(source.id, new Set([channel.id]))
  } catch (e) {
    return dbFailure('versions:restore:lineage', e)
  }
  const latest = pickLatest(lineageRows(lineage))
  if (!latest) return fail(NOT_FOUND)
  if (latest.id === source.id) return fail('이미 최신 버전입니다.')

  const parent = await decideVersionParent(
    s,
    ctx.data,
    v.announce === true,
    lineage.filter(r => !r.message_deleted).map(r => r.id)
  )
  if ('error' in parent) return fail(parent.error)

  const path = buildUploadPath(crypto.randomUUID(), source.name)
  const copiedThumb = source.mime.startsWith('image/')
  try {
    await copyObject(source.bucket_path, path)
  } catch (e) {
    console.error('[versions:restore:copy]', e)
    return fail('옛 버전 파일을 복사하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  if (copiedThumb) {
    await copyObject(thumbPathOf(source.bucket_path), thumbPathOf(path)).catch(() => undefined)
  }

  let saved: Awaited<ReturnType<typeof commitFileMessage>>
  try {
    saved = await commitFileMessage({
      actorId: s.user.id,
      message: {
        id: crypto.randomUUID(),
        channelId: channel.id,
        parentId: parent.parentId,
        canPostRestricted: parent.canPostRestricted,
        body: no => versionRestoredBody(s.staff.display_name, source.name, source.version_no, no),
      },
      source: {
        kind: 'copy',
        blobPath: path,
        name: source.name,
        mime: source.mime,
        size: source.size,
        width: source.width,
        height: source.height,
      },
      previousAttachmentId: latest.id,
      folderPath: latest.folder_path,
      clearOwnCheckout: true,
    })
  } catch (e) {
    await removeObjects(copiedThumb ? [path, thumbPathOf(path)] : [path]).catch(() => undefined)
    if (isWorkWriteError(e, 'conflict')) {
      return fail('다른 사람이 먼저 새 버전을 저장했습니다. 새로 고친 뒤 다시 시도해 주세요.')
    }
    return commitFailure('versions:restore:insert', e)
  }
  const created = saved as Extract<typeof saved, { status: 'created' }>
  await logAudit(
    s.user.id,
    'file.version_restore',
    { type: 'attachment', id: created.attachment.id },
    {
      channel_id: channel.id,
      restored_from: source.id,
      from_no: source.version_no,
      to_no: created.attachment.version_no,
    }
  )
  return ok({ attachmentId: created.attachment.id, versionNo: created.attachment.version_no })
}

/** 최종본 지정/해제. 지정은 `{ attachmentId }`, 해제는 `{ rootAttachmentId, clear: true }` */
export async function markFinalVersion(input: unknown): Promise<ActionResult> {
  const s = await requireWorkStaff()
  const parsed = markFinalSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data

  if ('attachmentId' in v) {
    const ctx = await loadEditContext(s, v.attachmentId)
    if (!ctx.ok) return fail(ctx.error)
    try {
      await setFinalVersion({
        rootId: ctx.data.rootId,
        channelId: ctx.data.channel.id,
        attachmentId: v.attachmentId,
        markedBy: s.user.id,
      })
    } catch (e) {
      return dbFailure('versions:final:set', e)
    }
    await logAudit(
      s.user.id,
      'file.mark_final',
      { type: 'attachment', id: v.attachmentId },
      { channel_id: ctx.data.channel.id, root: ctx.data.rootId }
    )
    return ok(undefined)
  }

  // 해제: 계보 행의 채널에서 편집 권한을 확인한다. 루트 첨부의 게시물이 지워졌어도 해제할 수 있어야 한다.
  let lineage: Awaited<ReturnType<typeof getFileLineage>>
  let access: ChannelAccessDecision | null = null
  try {
    lineage = await getFileLineage(v.rootAttachmentId)
    if (lineage) access = await loadChannelAccess(viewerOf(s), lineage.channel_id)
  } catch (e) {
    return dbFailure('versions:final:read', e)
  }
  if (!lineage) return ok(undefined)
  if (!access || !access.canRead) return fail(NOT_FOUND)
  const denied = editDeniedMessage(
    { isGuest: s.staff.role === 'guest', isMember: access.isMember },
    { channelArchived: access.archived, messageDeleted: false }
  )
  if (denied) return fail(denied)

  try {
    await clearFinalVersion(v.rootAttachmentId)
  } catch (e) {
    return dbFailure('versions:final:clear', e)
  }
  await logAudit(
    s.user.id,
    'file.unmark_final',
    { type: 'attachment', id: v.rootAttachmentId },
    { channel_id: lineage.channel_id }
  )
  return ok(undefined)
}

/**
 * 계보 전체 + 수정 중 정보 + 내 편집 권한. 읽을 수 있는 파일만(아니면 NOT_FOUND).
 * 화면은 이 값으로 버튼 노출·배지·버전 기록을 그린다.
 */
export async function listFileVersions(input: unknown): Promise<ActionResult<FileVersionState>> {
  const s = await requireWorkStaff()
  const { user, staff } = s
  const parsed = listVersionsSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const viewer = viewerOf(s)

  try {
    const att = await getAttachmentForEdit(parsed.data.attachmentId)
    if (!att) return fail(NOT_FOUND)
    const access = await loadChannelAccess(viewer, att.channel_id)
    // 원본 attachments_live_select: 읽을 수 없는 채널·지워진 게시물의 첨부는 보이지 않는다
    if (!access || !access.canRead || att.message_deleted_at) return fail(NOT_FOUND)
    const rootId = lineageRootId(att)

    const [rows, lineage] = await Promise.all([
      listLineageVersions(att.id, new Set([att.channel_id])),
      getFileLineage(rootId),
    ])

    let checkout: FileCheckout | null = null
    if (
      lineage &&
      isCheckoutActive({
        checkout_user_id: lineage.checkout_user_id,
        checkout_until: lineage.checkout_until,
      }) &&
      lineage.checkout_user_id
    ) {
      checkout = {
        userId: lineage.checkout_user_id,
        userName: lineage.checkout_user_name,
        since: lineage.checkout_at ?? lineage.checkout_until ?? new Date().toISOString(),
        until: lineage.checkout_until as string,
        mine: lineage.checkout_user_id === user.id,
      }
    }

    const latest = pickLatest(lineageRows(rows))
    const finalId = lineage?.final_attachment_id ?? null
    const canEdit = canEditFile(
      { isGuest: staff.role === 'guest', isMember: access.isMember },
      { channelArchived: access.archived, messageDeleted: false }
    )
    const isAdmin = isWorkAdmin(viewer)
    // 사본으로 새 문서(docs/16 §6) — 편집 권한 + 최상위 게시 규칙(공지 채널은 owner·관리자만)
    const canCopy = canEdit && (access.postPolicy !== 'owners' || canPostRestricted(viewer, access))
    return ok({
      attachmentId: att.id,
      channelId: att.channel_id,
      rootId,
      versions: rows.map(r => ({
        id: r.id,
        versionNo: r.version_no,
        name: r.name,
        mime: r.mime,
        size: r.size,
        createdAt: r.created_at,
        uploaderName: r.uploader_name,
        deleted: r.message_deleted,
        isLatest: latest?.id === r.id,
        isFinal: finalId === r.id,
      })),
      versionNo: att.version_no,
      latestId: latest?.id ?? null,
      finalId,
      checkout,
      canEdit,
      canCopy,
      isAdmin,
      viewerId: user.id,
    })
  } catch (e) {
    return dbFailure('versions:list', e)
  }
}

/** 자료실 목록 패널 "내가 수정 중인 파일" — 아직 유효한(8시간 안) 내 수정 중, 가져간 순 */
export async function listMyCheckouts(): Promise<ActionResult<MyCheckoutItem[]>> {
  const s = await requireWorkStaff()
  try {
    const readable = await readableChannelIds(viewerOf(s))
    return ok(await listMyCheckoutRecords(s.user.id, new Date(), readable))
  } catch (e) {
    return dbFailure('versions:myCheckouts', e)
  }
}
