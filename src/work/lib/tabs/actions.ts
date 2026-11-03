'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  isWorkAdmin,
  loadChannelAccess,
  viewerOf,
  type ChannelAccessDecision,
  type WorkViewer,
} from '@/lib/server/boardWorkChannelAuth'
import {
  canAddConversationTab,
  canManageConversationTab,
  canWriteArchivedTabs,
} from '@/lib/server/boardWorkTabAuth'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { getChannelRecordById } from '@/db/queries/work/channels'
import { insertMessage } from '@/db/queries/work/messages'
import {
  deleteTabRow,
  getTabRow,
  insertTabAnnouncement,
  insertTabRow,
  listTabRows,
  renameTabRow,
  reorderTabRows,
  type WorkTabRecord,
} from '@/db/queries/work/tabs'
import { logAudit } from '@work/lib/audit/log'
import {
  dbFailure,
  fail,
  FORBIDDEN_MESSAGE,
  invalid,
  ok,
  type ActionResult,
} from '@work/lib/channels/action-result'
import { refreshShell, writeLimited } from '@work/lib/channels/action-support'
import { canPostTopLevel, normalizePostPolicy } from '@work/lib/channels/post-policy'
import { websiteHost } from './website'
import { conversationBasePath, conversationTabHref, customTabKey } from './paths'
import {
  addTabSchema,
  listChannelFilesSchema,
  moveTabSchema,
  removeTabSchema,
  fileUploadedMessage,
  postFileUploadSchema,
  renameTabSchema,
  tabAddedMessage,
} from './schema'
import { changedPositions, moveInOrder } from './order'
import { listConversationFileOptions, toTabItem, type FileOption } from './queries'
import type { ConversationTabItem } from './types'

/**
 * 대화 탭 서버 액션 — 원본 kosmart-work `lib/tabs/actions.ts`와 같은 이름·입력·반환 모양.
 * 원본은 RLS(conversation_tabs_* + can_manage_conversation_tab 0026)가 권한을, trg_10_harden이 데이터 규칙을 지켰다.
 * 여기서는 권한을 `boardWorkTabAuth`로 판정하고, 데이터 규칙(20개·https·같은 대화의 메모/파일·할 일 탭 1개·보관 채널)은
 * 쿼리 계층(`@/db/queries/work/tabs`)이 같은 트랜잭션에서 지킨다. 탭이 바뀌면 쿼리 층이 `tabs_rev`를 올려 다른 사람의
 * 탭 바가 폴링으로 다시 그려진다(02-sync.md).
 *
 * 원본과 다른 점:
 * - 위키 탭(`listWikiDocOptions`)은 없다(위키 미이식).
 * - 파일 탭용 업로드 게시물(`postFileUploadMessage`)은 업로드(2a)와 함께 옮긴다.
 * - 메모 탭은 메모와 같은 트랜잭션에서 만든다(원본은 service_role로 메모를 먼저 넣고 실패하면 치웠다).
 */

const NOT_FOUND_OR_FORBIDDEN = '탭을 찾을 수 없거나 권한이 없습니다.'
const GUEST_MESSAGE = '서브관리자는 탭을 추가할 수 없습니다.'
const ARCHIVED_MESSAGE = '보관된 채널의 탭은 바꿀 수 없습니다.'

type TabResult = { tab: ConversationTabItem; href: string }

/** 쿼리 층이 던진 데이터 규칙 위반 → 원본과 같은 사용자 문구(23514 메시지는 그대로 보여도 되는 문구다) */
function writeFailure<T>(where: string, e: unknown): ActionResult<T> {
  if (isWorkWriteError(e)) {
    switch (e.code) {
      case 'invalid':
      case 'limit':
      case 'invalid_target':
      case 'conflict':
        return fail(`${e.message}.`)
      case 'archived':
        return fail(ARCHIVED_MESSAGE)
      case 'forbidden':
        return fail(FORBIDDEN_MESSAGE)
      case 'not_found':
        return fail(NOT_FOUND_OR_FORBIDDEN)
    }
  }
  return dbFailure(where, e)
}

/**
 * 탭과 그 채널 판정. 탭이 없거나 그 대화를 읽을 수 없으면 null(원본 RLS가 0행을 돌려주던 자리 — 존재를 드러내지 않는다).
 */
async function loadTabWithAccess(
  viewer: WorkViewer,
  tabId: string
): Promise<{ tab: WorkTabRecord; access: ChannelAccessDecision } | null> {
  const tab = await getTabRow(tabId)
  if (!tab) return null
  const access = await loadChannelAccess(viewer, tab.channel_id)
  if (!access?.canRead) return null
  return { tab, access }
}

export async function addTab(input: unknown): Promise<ActionResult<TabResult>> {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const parsed = addTabSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  if (staff.role === 'guest') return fail(GUEST_MESSAGE)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  let access: ChannelAccessDecision | null
  let channel: Awaited<ReturnType<typeof getChannelRecordById>>
  try {
    ;[access, channel] = await Promise.all([
      loadChannelAccess(viewer, v.channelId),
      getChannelRecordById(v.channelId),
    ])
  } catch (e) {
    return dbFailure('tabs:add:channel', e)
  }
  if (!access?.canRead || !channel) return fail(FORBIDDEN_MESSAGE)
  if (access.archived) return fail('보관된 채널에는 탭을 추가할 수 없습니다.')
  if (!canAddConversationTab(viewer, access)) return fail(FORBIDDEN_MESSAGE)

  let row: WorkTabRecord
  try {
    row = await insertTabRow({
      channelId: v.channelId,
      kind: v.kind,
      title: v.title,
      config: v.config as Record<string, unknown>,
      createdBy: user.id,
      canWriteArchived: false,
    })
  } catch (e) {
    return writeFailure('tabs:add', e)
  }
  const tab = toTabItem(row)
  if (!tab) return fail('탭을 추가하지 못했습니다.')

  // 웹사이트 탭은 임의 https 주소를 대화 안에 띄운다 — 누가 어떤 주소를 붙였는지 남긴다(주소는 호스트만)
  if (v.kind === 'website') {
    await logAudit(
      user.id,
      'tab.add_website',
      { type: 'conversation_tab', id: tab.id },
      { channel_id: v.channelId, host: websiteHost(v.config.url) }
    )
  }

  // 공지 채널에서 일반 멤버의 "게시물에 알리기"는 탭만 추가하고 게시물은 만들지 않는다(원본 canPostTopLevelHere)
  const mayAnnounce =
    v.announce &&
    canPostTopLevel({
      policy: normalizePostPolicy(access.postPolicy),
      isChannelOwner: access.isOwner,
      isWorkAdmin: isWorkAdmin(viewer),
    })
  if (mayAnnounce) {
    try {
      await insertTabAnnouncement({
        channelId: v.channelId,
        authorId: user.id,
        body: tabAddedMessage(staff.display_name, tab.title),
      })
    } catch (e) {
      // 곁가지 — 탭 추가는 성공으로 둔다(원본도 로그만)
      console.error('[tabs:add:systemMessage]', e)
    }
  }

  refreshShell()
  return ok({
    tab,
    href: conversationTabHref(conversationBasePath(channel), customTabKey(tab.id)),
  })
}

export async function renameTab(input: unknown): Promise<ActionResult<{ title: string }>> {
  const ctx = await requireWorkStaff()
  const parsed = renameTabSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  let found: Awaited<ReturnType<typeof loadTabWithAccess>>
  try {
    found = await loadTabWithAccess(viewer, parsed.data.tabId)
  } catch (e) {
    return dbFailure('tabs:rename:read', e)
  }
  if (!found) return fail(NOT_FOUND_OR_FORBIDDEN)
  if (found.access.archived && !canWriteArchivedTabs(viewer)) return fail(ARCHIVED_MESSAGE)
  if (!canManageConversationTab(viewer, found.access, found.tab.created_by)) {
    return fail(NOT_FOUND_OR_FORBIDDEN)
  }

  try {
    const row = await renameTabRow({
      tabId: found.tab.id,
      title: parsed.data.title,
      canWriteArchived: canWriteArchivedTabs(viewer),
    })
    if (!row) return fail(NOT_FOUND_OR_FORBIDDEN)
    refreshShell()
    return ok({ title: row.title })
  } catch (e) {
    return writeFailure('tabs:rename', e)
  }
}

export async function removeTab(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const parsed = removeTabSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  let found: Awaited<ReturnType<typeof loadTabWithAccess>>
  try {
    found = await loadTabWithAccess(viewer, parsed.data.tabId)
  } catch (e) {
    return dbFailure('tabs:remove:read', e)
  }
  if (!found) return fail(NOT_FOUND_OR_FORBIDDEN)
  if (found.access.archived && !canWriteArchivedTabs(viewer)) return fail(ARCHIVED_MESSAGE)
  if (!canManageConversationTab(viewer, found.access, found.tab.created_by)) {
    return fail(NOT_FOUND_OR_FORBIDDEN)
  }

  try {
    const row = await deleteTabRow({
      tabId: found.tab.id,
      canWriteArchived: canWriteArchivedTabs(viewer),
    })
    if (!row) return fail(NOT_FOUND_OR_FORBIDDEN)
  } catch (e) {
    return writeFailure('tabs:remove', e)
  }
  refreshShell()
  return ok(undefined)
}

/**
 * 파일 탭 추가 대화상자의 "이 대화의 파일에서 고르기" 목록(멤버·내부 staff).
 * 삭제되지 않은 첨부(이전 버전 포함) 최신순 50개(`listConversationFileOptions`).
 */
export async function listFileOptions(input: unknown): Promise<ActionResult<FileOption[]>> {
  const ctx = await requireWorkStaff()
  const parsed = listChannelFilesSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (ctx.staff.role === 'guest') return fail(GUEST_MESSAGE)
  try {
    const access = await loadChannelAccess(viewerOf(ctx), parsed.data.channelId)
    if (!access?.canRead) return fail(FORBIDDEN_MESSAGE)
    return ok(await listConversationFileOptions(ctx, parsed.data.channelId, parsed.data.q))
  } catch (e) {
    return dbFailure('tabs:listFiles', e)
  }
}

/**
 * 파일 탭용 업로드 게시물(＋ 대화상자 "새로 올리기") — "A님이 'x' 파일을 올렸습니다." 를 만들고 id 를 돌려준다.
 * 이어서 클라이언트가 attachUploads(messageId, …)로 첨부를 확정한다(use-tab-file-upload). 원본 kosmart-work
 * `postFileUploadMessage`(service_role 게시) — 멤버·내부 구성원·보관 아님·공지 채널은 owner·관리자만을 여기서 판정하고,
 * 쿼리 층이 같은 데이터 규칙(작성자 = 멤버·보관·공지 채널)을 트랜잭션 안에서 다시 본다.
 */
export async function postFileUploadMessage(
  input: unknown
): Promise<ActionResult<{ messageId: string }>> {
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  const parsed = postFileUploadSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  if (staff.role === 'guest') return fail(GUEST_MESSAGE)
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)
  let access: ChannelAccessDecision | null
  try {
    access = await loadChannelAccess(viewer, v.channelId)
  } catch (e) {
    return dbFailure('tabs:upload:access', e)
  }
  if (!access || !access.isMember) return fail(FORBIDDEN_MESSAGE)
  if (access.archived) return fail('보관된 채널에는 파일을 올릴 수 없습니다.')
  const restricted = access.isOwner || isWorkAdmin(viewer)
  if (
    !canPostTopLevel({
      policy: normalizePostPolicy(access.postPolicy),
      isChannelOwner: access.isOwner,
      isWorkAdmin: isWorkAdmin(viewer),
    })
  ) {
    return fail('이 채널은 소유자와 관리자만 글을 올릴 수 있어, 파일을 올릴 수 없습니다.')
  }
  const messageId = crypto.randomUUID()
  try {
    await insertMessage({
      id: messageId,
      channelId: v.channelId,
      authorId: user.id,
      body: fileUploadedMessage(staff.display_name, v.fileName, v.purpose),
      canPostRestricted: restricted,
    })
  } catch (e) {
    return writeFailure('tabs:upload:message', e)
  }
  return ok({ messageId })
}

/**
 * 탭 순서 바꾸기 — 한 칸 왼쪽/오른쪽. 권한은 **옮기는 탭**에 대한 can_manage_conversation_tab이다. 순서는 표시 속성이라
 * 이웃 탭 주인의 동의를 구하지 않는다(원본이 service_role로 position만 갱신하던 것과 같다). 이 대화의 모든 탭을
 * 0..n-1로 다시 매기고 바뀐 것만 쓴다.
 */
export async function moveTab(input: unknown): Promise<ActionResult<{ moved: boolean }>> {
  const ctx = await requireWorkStaff()
  // 게스트는 DM·채널 어디서도 탭을 바꿀 수 없다(원본 0026)
  if (ctx.staff.role === 'guest') return fail(GUEST_MESSAGE)
  const parsed = moveTabSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { tabId, direction } = parsed.data
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  let found: Awaited<ReturnType<typeof loadTabWithAccess>>
  let rows: WorkTabRecord[]
  try {
    found = await loadTabWithAccess(viewer, tabId)
    if (!found) return fail(NOT_FOUND_OR_FORBIDDEN)
    rows = await listTabRows(found.tab.channel_id)
  } catch (e) {
    return dbFailure('tabs:move:read', e)
  }
  if (found.access.archived && !canWriteArchivedTabs(viewer)) return fail(ARCHIVED_MESSAGE)
  if (!canManageConversationTab(viewer, found.access, found.tab.created_by)) {
    return fail(NOT_FOUND_OR_FORBIDDEN)
  }

  const next = moveInOrder(
    rows.map(r => r.id),
    tabId,
    direction
  )
  if (!next) return ok({ moved: false })
  const changes = changedPositions(next, new Map(rows.map(r => [r.id, r.position])))
  try {
    await reorderTabRows({
      channelId: found.tab.channel_id,
      changes,
      canWriteArchived: canWriteArchivedTabs(viewer),
    })
  } catch (e) {
    return writeFailure('tabs:move:update', e)
  }
  refreshShell()
  return ok({ moved: true })
}
