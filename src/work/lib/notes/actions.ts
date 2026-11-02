'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { loadChannelAccess, viewerOf, type WorkViewer } from '@/lib/server/boardWorkChannelAuth'
import { canWriteArchivedTabs, canWriteConversationNote } from '@/lib/server/boardWorkTabAuth'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { getNoteChannelId, saveNoteRow } from '@/db/queries/work/notes'
import {
  dbFailure,
  fail,
  FORBIDDEN_MESSAGE,
  invalid,
  ok,
  type ActionResult,
} from '@work/lib/channels/action-result'
import { writeLimited } from '@work/lib/channels/action-support'
import { sanitizeUserMarkdown } from '@work/lib/markdown/sanitize-markdown'
import { getRevision, listRevisions, toNoteData } from './queries'
import {
  noteIdSchema,
  noteRevisionSchema,
  revertNoteSchema,
  saveNoteSchema,
  type NoteRevision,
  type NoteRevisionMeta,
  type SaveNoteResult,
} from './schema'

/**
 * 메모 탭 서버 액션 — 원본 kosmart-work `lib/notes/actions.ts`와 같은 이름·입력·반환 모양.
 * 원본은 RLS(conversation_notes_update = 대화 멤버 ∧ 내부 staff, 0033 보관 채널)가 권한을, trg_10_harden이 version·
 * updated_by를, AFTER 트리거가 이력을 맡았다. 여기서는 권한을 `boardWorkTabAuth`로 판정하고, 낙관적 잠금·version·이력
 * 200개·tabs_rev는 쿼리 계층(`saveNoteRow`)이 한 트랜잭션에서 한다. 메모 생성은 탭과 함께(`tabs/actions.addTab`).
 */

const NOT_FOUND_OR_FORBIDDEN = '메모를 찾을 수 없거나 권한이 없습니다.'
const GUEST_MESSAGE = '서브관리자는 메모를 고칠 수 없습니다.'
const ARCHIVED_MESSAGE = '보관된 채널의 메모는 고칠 수 없습니다.'

/**
 * 쓰기 전 판정: 읽을 수 없으면 not-found 문구(존재를 드러내지 않는다), 보관 채널은 관리자만, 쓰기는 대화 멤버(내부 staff)만.
 * null이면 계속 진행.
 */
async function writeGuard(viewer: WorkViewer, noteId: string): Promise<ActionResult<never> | null> {
  const channelId = await getNoteChannelId(noteId)
  if (!channelId) return fail(NOT_FOUND_OR_FORBIDDEN)
  const access = await loadChannelAccess(viewer, channelId)
  if (!access?.canRead) return fail(NOT_FOUND_OR_FORBIDDEN)
  if (access.archived && !canWriteArchivedTabs(viewer)) return fail(ARCHIVED_MESSAGE)
  if (!canWriteConversationNote(viewer, access)) return fail(FORBIDDEN_MESSAGE)
  return null
}

/** 기대 버전과 같을 때만 본문을 바꾼다(쿼리 계층이 판정 — 다르면 conflict와 최신 메모) */
async function writeBody(
  viewer: WorkViewer,
  noteId: string,
  expectedVersion: number,
  body: string
): Promise<ActionResult<SaveNoteResult>> {
  try {
    const outcome = await saveNoteRow({
      noteId,
      expectedVersion,
      body: sanitizeUserMarkdown(body),
      actorId: viewer.userId,
      canWriteArchived: canWriteArchivedTabs(viewer),
    })
    if (!outcome) return fail(NOT_FOUND_OR_FORBIDDEN)
    if (outcome.status === 'conflict') {
      return ok({ status: 'conflict', latest: toNoteData(outcome.latest) })
    }
    return ok({ status: 'saved', note: toNoteData(outcome.note) })
  } catch (e) {
    if (isWorkWriteError(e, 'archived')) return fail(ARCHIVED_MESSAGE)
    if (isWorkWriteError(e, 'forbidden')) return fail(FORBIDDEN_MESSAGE)
    if (isWorkWriteError(e, 'invalid')) return fail(`${e.message}.`)
    return dbFailure('notes:save', e)
  }
}

export async function saveNote(input: unknown): Promise<ActionResult<SaveNoteResult>> {
  const ctx = await requireWorkStaff()
  const parsed = saveNoteSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (ctx.staff.role === 'guest') return fail(GUEST_MESSAGE)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)
  try {
    const blocked = await writeGuard(viewer, parsed.data.noteId)
    if (blocked) return blocked
  } catch (e) {
    return dbFailure('notes:save:guard', e)
  }
  return writeBody(viewer, parsed.data.noteId, parsed.data.expectedVersion, parsed.data.body)
}

/** 이력의 한 버전 본문으로 되돌린다 — 되돌리기도 새 버전이다(이력은 지우지 않는다) */
export async function revertNote(input: unknown): Promise<ActionResult<SaveNoteResult>> {
  const ctx = await requireWorkStaff()
  const parsed = revertNoteSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  if (ctx.staff.role === 'guest') return fail(GUEST_MESSAGE)
  const v = parsed.data
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  let revision: NoteRevision | null
  try {
    const blocked = await writeGuard(viewer, v.noteId)
    if (blocked) return blocked
    revision = await getRevision(ctx, v.noteId, v.toVersion)
  } catch (e) {
    return dbFailure('notes:revert:read', e)
  }
  if (!revision)
    return fail('되돌릴 버전을 찾을 수 없습니다. 이력이 오래되어 지워졌을 수 있습니다.')
  return writeBody(viewer, v.noteId, v.expectedVersion, revision.body)
}

export async function listNoteRevisions(input: unknown): Promise<ActionResult<NoteRevisionMeta[]>> {
  const ctx = await requireWorkStaff()
  const parsed = noteIdSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    return ok(await listRevisions(ctx, parsed.data.noteId))
  } catch (e) {
    return dbFailure('notes:revisions', e)
  }
}

export async function getNoteRevision(input: unknown): Promise<ActionResult<NoteRevision>> {
  const ctx = await requireWorkStaff()
  const parsed = noteRevisionSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    const rev = await getRevision(ctx, parsed.data.noteId, parsed.data.version)
    return rev ? ok(rev) : fail('해당 버전을 찾을 수 없습니다.')
  } catch (e) {
    return dbFailure('notes:revision', e)
  }
}
