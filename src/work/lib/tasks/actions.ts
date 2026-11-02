'use server'

import { requireWorkStaff, workRoleOf, isWorkAdminRole } from '@/lib/server/boardWorkAuth'
import {
  isWorkAdmin,
  loadChannelAccess,
  viewerOf,
  type WorkViewer,
} from '@/lib/server/boardWorkChannelAuth'
import { canCreateTask } from '@/lib/server/boardWorkTabAuth'
import { isWorkWriteError } from '@/db/queries/work/_shared'
import { getChannelAccess } from '@/db/queries/work/access'
import { getWorkPeople } from '@/db/queries/work/directory'
import {
  deleteTaskRow,
  getTaskRecord,
  insertTaskRow,
  updateTaskRow,
  type TaskPatch,
} from '@/db/queries/work/tasks'
import {
  dbFailure,
  fail,
  FORBIDDEN_MESSAGE,
  invalid,
  ok,
  type ActionResult,
} from '@work/lib/channels/action-result'
import { refreshShell, writeLimited } from '@work/lib/channels/action-support'
import { canReadChannelAsAssignee } from './assignees'
import { toTaskItem } from './map'
import { createTaskSchema, deleteTaskSchema, toggleTaskSchema, updateTaskSchema } from './schema'
import type { TaskItem } from './types'

/**
 * 할 일 서버 액션 — 원본 kosmart-work `lib/tasks/actions.ts`와 같은 이름·입력·반환 모양.
 * 원본은 RLS(tasks_*: 읽기 = can_read_channel, 생성 = 채널 멤버, 수정 = 생성자·담당자·채널 owner·관리자(OLD 행 기준),
 * 삭제 = 생성자·관리자, 0036 보관 채널)와 trg_10_harden(작성자 강제·특권 열 동결·완료 정보)이 지켰다.
 * 여기서는 읽기·생성 자격을 판정하고, OLD 행 기준 수정·삭제 판정과 하드닝은 쿼리 계층이 쓰는 트랜잭션 안에서 한다.
 * 완료해도 푸시는 보내지 않는다(원본과 같다).
 */

const NOT_FOUND = '할 일을 찾을 수 없거나 수정 권한이 없습니다.'
const ARCHIVED_MESSAGE = '보관된 채널의 할 일은 바꿀 수 없습니다.'
const ASSIGNEE_NOT_FOUND = '담당자를 찾을 수 없습니다.'
const ASSIGNEE_CANNOT_READ = '담당자는 이 채널을 볼 수 있는 사람이어야 합니다.'

/**
 * 담당자 검증: 활성 구성원이고 그 채널을 읽을 수 있어야 한다(assignees.ts — 화면 후보와 같은 규칙).
 * 실패하면 돌려줄 ActionResult, 통과하면 null.
 */
async function checkAssignee(
  channelId: string,
  userId: string
): Promise<ActionResult<never> | null> {
  const [people, access] = await Promise.all([
    getWorkPeople([userId]),
    getChannelAccess(channelId, userId),
  ])
  const role = workRoleOf(people.get(userId) ?? null)
  if (!role) return fail(ASSIGNEE_NOT_FOUND)
  if (!access) return fail(ASSIGNEE_CANNOT_READ)
  const allowed = canReadChannelAsAssignee(
    { guest: role === 'guest', admin: isWorkAdminRole(role) },
    { kind: access.kind, isMember: access.memberRole !== null }
  )
  return allowed ? null : fail(ASSIGNEE_CANNOT_READ)
}

function writeFailure<T>(where: string, e: unknown): ActionResult<T> {
  if (isWorkWriteError(e, 'archived')) return fail(ARCHIVED_MESSAGE)
  if (isWorkWriteError(e, 'forbidden')) return fail(FORBIDDEN_MESSAGE)
  if (isWorkWriteError(e, 'invalid') || isWorkWriteError(e, 'invalid_target')) {
    return fail(`${e.message}.`)
  }
  return dbFailure(where, e)
}

/** 할 일이 있고 그 채널을 읽을 수 있으면 채널 id. 아니면 null(원본 RLS 0행 — 존재를 드러내지 않는다) */
async function readableTaskChannel(viewer: WorkViewer, taskId: string): Promise<string | null> {
  const task = await getTaskRecord(taskId)
  if (!task) return null
  const access = await loadChannelAccess(viewer, task.channel_id)
  return access?.canRead ? task.channel_id : null
}

export async function createTask(input: unknown): Promise<ActionResult<{ task: TaskItem }>> {
  const ctx = await requireWorkStaff()
  const { user } = ctx
  const parsed = createTaskSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const limited = await writeLimited(user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  try {
    const access = await loadChannelAccess(viewer, v.channelId)
    if (!access?.canRead || !canCreateTask(access)) return fail(FORBIDDEN_MESSAGE)
    if (access.archived && !isWorkAdmin(viewer)) {
      return fail('보관된 채널에는 할 일을 만들 수 없습니다.')
    }
    if (v.assigneeId) {
      const failure = await checkAssignee(v.channelId, v.assigneeId)
      if (failure) return failure
    }
  } catch (e) {
    return dbFailure('createTask:check', e)
  }

  try {
    const row = await insertTaskRow({
      channelId: v.channelId,
      createdBy: user.id,
      actorIsAdmin: isWorkAdmin(viewer),
      title: v.title,
      note: v.note ?? null,
      messageId: v.messageId ?? null,
      assigneeId: v.assigneeId ?? null,
      dueOn: v.dueOn ?? null,
    })
    refreshShell()
    return ok({ task: toTaskItem(row, user.id) })
  } catch (e) {
    return writeFailure('createTask', e)
  }
}

async function applyPatch(
  viewer: WorkViewer,
  id: string,
  patch: TaskPatch,
  where: string
): Promise<ActionResult> {
  try {
    const channelId = await readableTaskChannel(viewer, id)
    if (!channelId) return fail(NOT_FOUND)
    if (patch.assigneeId) {
      // 담당자 후보는 할 일이 속한 채널 기준이다
      const failure = await checkAssignee(channelId, patch.assigneeId)
      if (failure) return failure
    }
  } catch (e) {
    return dbFailure(`${where}:check`, e)
  }
  try {
    const result = await updateTaskRow({
      id,
      actorId: viewer.userId,
      actorIsAdmin: isWorkAdmin(viewer),
      patch,
    })
    if (result !== 'updated') return fail(NOT_FOUND)
  } catch (e) {
    return writeFailure(where, e)
  }
  refreshShell()
  return ok(undefined)
}

export async function updateTask(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const parsed = updateTaskSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const v = parsed.data
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited

  const patch: TaskPatch = {}
  if (v.title !== undefined) patch.title = v.title
  if (v.note !== undefined) patch.note = v.note
  if (v.assigneeId !== undefined) patch.assigneeId = v.assigneeId
  if (v.dueOn !== undefined) patch.dueOn = v.dueOn
  return applyPatch(viewerOf(ctx), v.id, patch, 'updateTask')
}

export async function toggleTaskDone(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const parsed = toggleTaskSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  return applyPatch(
    viewerOf(ctx),
    parsed.data.id,
    { status: parsed.data.done ? 'done' : 'open' },
    'toggleTaskDone'
  )
}

export async function deleteTask(input: unknown): Promise<ActionResult> {
  const ctx = await requireWorkStaff()
  const parsed = deleteTaskSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(ctx.user.id)
  if (limited) return limited
  const viewer = viewerOf(ctx)

  try {
    if (!(await readableTaskChannel(viewer, parsed.data.id))) return fail(FORBIDDEN_MESSAGE)
    const result = await deleteTaskRow({
      id: parsed.data.id,
      actorId: viewer.userId,
      actorIsAdmin: isWorkAdmin(viewer),
    })
    if (result !== 'deleted') return fail(FORBIDDEN_MESSAGE)
  } catch (e) {
    return writeFailure('deleteTask', e)
  }
  refreshShell()
  return ok(undefined)
}
