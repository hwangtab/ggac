/**
 * 할 일(`work_tasks`) 쿼리 — 원본 kosmart-work 0006(`harden_tasks_write`·RLS)과 0036(담당자 수정·보관 채널)을 TS로 옮겼다.
 *
 * 읽기 범위(원본 tasks_select = can_read_channel)는 호출부가 `readable`로 넘긴다 — 그 밖의 행은 절대 돌려주지 않는다.
 * 쓰기 규칙은 **원본 RLS와 트리거를 데이터 규칙으로** 여기서 지킨다(쓰는 트랜잭션 안에서 OLD 행 기준):
 *
 * | 원본                                     | 여기                                                        |
 * | ---------------------------------------- | ----------------------------------------------------------- |
 * | tasks_insert: created_by=auth.uid() ∧ 채널 멤버 | `insertTaskRow` — 작성자는 인자(행위자)로만, 그 채널의 멤버여야 한다 |
 * | harden INSERT: message_id는 같은 채널의 메시지 | `invalid_target`                                          |
 * | tasks_update(0006·0036 OLD 행 기준): 생성자·담당자·채널 owner·관리자 | `updateTaskRow` — 행위자의 채널 역할을 트랜잭션 안에서 읽는다 |
 * | harden UPDATE: id·channel·message·created_by·created_at 동결 | 바꿀 수 있는 열(title·note·assignee·due·status)만 받는다 |
 * | completed_at/by는 status 전이로만         | `transition`(open→done: now·행위자, done→open: null, 그대로면 유지) |
 * | tasks_delete: 생성자·관리자               | `deleteTaskRow`                                             |
 * | 0036 K2 보관 채널 쓰기 금지(관리자 예외)  | `actorIsAdmin`                                              |
 *
 * 쓰기마다 그 채널의 `tabs_rev`를 올린다 — 원본에는 할 일 실시간 신호가 없었지만, 할 일 탭을 열어 둔 사람의 화면이
 * 폴링으로 갱신되게 한다(탭 본문이 바뀐 것으로 본다. 02-sync.md §1).
 */
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  memberProfiles,
  workChannelMembers,
  workChannels,
  workMessages,
} from '../../schema/index.ts'
import { workTasks } from '../../schema/workTabs.ts'
import { bumpChannelRev, chunks, iso, isoNN, WorkWriteError, type WorkExecutor } from './_shared.ts'

export const TASK_TITLE_MAX = 200
export const TASK_NOTE_MAX = 2000
export const TASK_OPEN_LIMIT = 500
export const TASK_DONE_LIMIT = 50

export type WorkTaskStatus = 'open' | 'done'

/** 원본 TASK_COLUMNS로 읽은 행(채널·담당자 임베드) — `lib/tasks/map.ts toTaskItem`이 그대로 받는다 */
export type WorkTaskRecord = {
  id: string
  channel_id: string
  message_id: string | null
  title: string
  note: string | null
  assignee_id: string | null
  due_on: string | null
  status: WorkTaskStatus
  created_by: string
  completed_at: string | null
  completed_by: string | null
  created_at: string
  channel: {
    name: string
    slug: string | null
    kind: 'public' | 'private' | 'dm'
    dm_key: string | null
    archived_at: string | null
    is_group: boolean
    title: string | null
  } | null
  assignee: { display_name: string } | null
}

const DUE_RE = /^\d{4}-\d{2}-\d{2}$/

const taskColumns = {
  id: workTasks.id,
  channelId: workTasks.channelId,
  messageId: workTasks.messageId,
  title: workTasks.title,
  note: workTasks.note,
  assigneeId: workTasks.assigneeId,
  dueOn: workTasks.dueOn,
  status: workTasks.status,
  createdBy: workTasks.createdBy,
  completedAt: workTasks.completedAt,
  completedBy: workTasks.completedBy,
  createdAt: workTasks.createdAt,
  chName: workChannels.name,
  chSlug: workChannels.slug,
  chKind: workChannels.kind,
  chDmKey: workChannels.dmKey,
  chArchivedAt: workChannels.archivedAt,
  chIsGroup: workChannels.isGroup,
  chTitle: workChannels.title,
  assigneeName: memberProfiles.displayName,
}

type TaskSelect = {
  id: string
  channelId: string
  messageId: string | null
  title: string
  note: string | null
  assigneeId: string | null
  dueOn: string | null
  status: string
  createdBy: string | null
  completedAt: Date | null
  completedBy: string | null
  createdAt: Date
  chName: string | null
  chSlug: string | null
  chKind: string | null
  chDmKey: string | null
  chArchivedAt: Date | null
  chIsGroup: boolean | null
  chTitle: string | null
  assigneeName: string | null
}

function toRecord(r: TaskSelect): WorkTaskRecord {
  const kind = r.chKind === 'private' || r.chKind === 'dm' ? r.chKind : 'public'
  return {
    id: r.id,
    channel_id: r.channelId,
    message_id: r.messageId,
    title: r.title,
    note: r.note,
    assignee_id: r.assigneeId,
    due_on: r.dueOn,
    status: r.status === 'done' ? 'done' : 'open',
    // 원본은 not null — 만든 사람의 프로필이 지워졌으면 빈 문자열(누구의 것도 아니다 → 관리자만 지운다)
    created_by: r.createdBy ?? '',
    completed_at: iso(r.completedAt),
    completed_by: r.completedBy,
    created_at: isoNN(r.createdAt),
    channel:
      r.chName === null
        ? null
        : {
            name: r.chName,
            slug: r.chSlug,
            kind,
            dm_key: r.chDmKey,
            archived_at: iso(r.chArchivedAt),
            is_group: Boolean(r.chIsGroup),
            title: r.chTitle,
          },
    assignee: r.assigneeName ? { display_name: r.assigneeName } : null,
  }
}

function baseSelect(ex: WorkExecutor = db) {
  return ex
    .select(taskColumns)
    .from(workTasks)
    .leftJoin(workChannels, eq(workChannels.id, workTasks.channelId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workTasks.assigneeId))
}

/** 원본 정렬: 마감 빠른 순(마감 없는 건 뒤), 같으면 최근 생성 순 */
const openOrder = [sql`${workTasks.dueOn} is null`, asc(workTasks.dueOn), desc(workTasks.createdAt)]

// ── 읽기 ─────────────────────────────────────────────────────────────────────

/** 할 일 탭: 이 채널의 미완료(상한 500) + 완료 최근 50. 읽기 범위 판정은 호출부 몫 */
export async function listTaskRecordsByChannel(channelId: string): Promise<WorkTaskRecord[]> {
  const [open, done] = await Promise.all([
    baseSelect()
      .where(and(eq(workTasks.channelId, channelId), eq(workTasks.status, 'open')))
      .orderBy(...openOrder)
      .limit(TASK_OPEN_LIMIT),
    baseSelect()
      .where(and(eq(workTasks.channelId, channelId), eq(workTasks.status, 'done')))
      .orderBy(desc(workTasks.completedAt))
      .limit(TASK_DONE_LIMIT),
  ])
  return [...open, ...done].map(toRecord)
}

/**
 * /tasks 목록(원본 listTasks): 읽을 수 있는 채널의 할 일 중 — 내 것(담당=나 또는 생성=나)을 먼저 확보하고
 * 그 밖의 것을 채운다. 미완료는 각각 상한 500, 완료는 최근 50. 읽기 범위 밖은 내 것이어도 돌려주지 않는다
 * (원본도 RLS가 먼저 걸렀다).
 */
export async function listTaskRecordsForViewer(input: {
  userId: string
  readable: ReadonlySet<string>
}): Promise<{ rows: WorkTaskRecord[]; openTruncated: boolean }> {
  const ids = [...input.readable]
  if (ids.length === 0) return { rows: [], openTruncated: false }
  const scope = inArray(workTasks.channelId, ids)
  const mine = or(eq(workTasks.assigneeId, input.userId), eq(workTasks.createdBy, input.userId))
  const q = (where: SQL | undefined, open: boolean) =>
    open
      ? baseSelect()
          .where(and(scope, where, eq(workTasks.status, 'open')))
          .orderBy(...openOrder)
          .limit(TASK_OPEN_LIMIT)
      : baseSelect()
          .where(and(scope, where, eq(workTasks.status, 'done')))
          .orderBy(desc(workTasks.completedAt))
          .limit(TASK_DONE_LIMIT)
  const [mineOpen, mineDone, allOpen, allDone] = await Promise.all([
    q(mine, true),
    q(mine, false),
    q(undefined, true),
    q(undefined, false),
  ])
  const byId = new Map<string, WorkTaskRecord>()
  let openTruncated = false
  for (const [rows, isOpen] of [
    [mineOpen, true],
    [mineDone, false],
    [allOpen, true],
    [allDone, false],
  ] as const) {
    if (isOpen && rows.length >= TASK_OPEN_LIMIT) openTruncated = true
    for (const r of rows) byId.set(r.id, toRecord(r))
  }
  return { rows: [...byId.values()], openTruncated }
}

/**
 * 사이드바 배지(원본 countMyOpenTasks): 미완료 중 담당=나 또는 (내가 만들었고 담당 없음),
 * 보관 채널 제외, 읽기 범위 안만.
 */
export async function countMyOpenTaskRecords(input: {
  userId: string
  readable: ReadonlySet<string>
}): Promise<number> {
  const ids = [...input.readable]
  if (ids.length === 0) return 0
  let total = 0
  for (const part of chunks(ids, 400)) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(workTasks)
      .innerJoin(workChannels, eq(workChannels.id, workTasks.channelId))
      .where(
        and(
          inArray(workTasks.channelId, part),
          eq(workTasks.status, 'open'),
          isNull(workChannels.archivedAt),
          or(
            eq(workTasks.assigneeId, input.userId),
            and(eq(workTasks.createdBy, input.userId), isNull(workTasks.assigneeId))
          )
        )
      )
    total += Number(row?.n ?? 0)
  }
  return total
}

/** 할 일 한 건. 없으면 null(읽기 범위 판정은 호출부 몫 — channel_id로 본다) */
export async function getTaskRecord(taskId: string): Promise<WorkTaskRecord | null> {
  const [row] = await baseSelect().where(eq(workTasks.id, taskId)).limit(1)
  return row ? toRecord(row) : null
}

// ── 쓰기 ─────────────────────────────────────────────────────────────────────

function normalizeTitle(raw: string): string {
  const title = String(raw ?? '').trim()
  if (title.length < 1 || title.length > TASK_TITLE_MAX) {
    throw new WorkWriteError('invalid', `할 일 제목은 1~${TASK_TITLE_MAX}자여야 합니다`)
  }
  return title
}

function normalizeNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  if (raw.length > TASK_NOTE_MAX) {
    throw new WorkWriteError('invalid', `메모는 ${TASK_NOTE_MAX}자까지 쓸 수 있습니다`)
  }
  return raw
}

function normalizeDue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (!DUE_RE.test(raw)) throw new WorkWriteError('invalid', '마감일 형식이 올바르지 않습니다')
  return raw
}

async function memberRole(
  tx: WorkExecutor,
  channelId: string,
  userId: string
): Promise<'owner' | 'member' | null> {
  const [m] = await tx
    .select({ role: workChannelMembers.role })
    .from(workChannelMembers)
    .where(and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId)))
    .limit(1)
  if (!m) return null
  return m.role === 'owner' ? 'owner' : 'member'
}

/** 원본 harden_tasks_write의 완료 정보 규칙 */
export function transition(
  oldRow: { status: string; completedAt: Date | null; completedBy: string | null } | null,
  nextStatus: WorkTaskStatus,
  actorId: string,
  now: Date
): { completedAt: Date | null; completedBy: string | null } {
  if (nextStatus === 'done' && (oldRow === null || oldRow.status !== 'done')) {
    return { completedAt: now, completedBy: actorId }
  }
  if (nextStatus === 'open') return { completedAt: null, completedBy: null }
  return { completedAt: oldRow?.completedAt ?? null, completedBy: oldRow?.completedBy ?? null }
}

/**
 * 할 일 만들기(원본 createTask의 INSERT + tasks_insert + harden). 작성자는 행위자(`createdBy`)로 고정, 그 채널의 멤버여야 한다.
 * 보관 채널은 관리자만(0036 K2). 원본 메시지는 같은 채널의 것만.
 */
export async function insertTaskRow(input: {
  channelId: string
  createdBy: string
  actorIsAdmin: boolean
  title: string
  note?: string | null
  messageId?: string | null
  assigneeId?: string | null
  dueOn?: string | null
  status?: WorkTaskStatus
}): Promise<WorkTaskRecord> {
  const title = normalizeTitle(input.title)
  const note = normalizeNote(input.note)
  const dueOn = normalizeDue(input.dueOn)
  const status: WorkTaskStatus = input.status === 'done' ? 'done' : 'open'
  const id = await db.transaction(async tx => {
    const [channel] = await tx
      .select({ id: workChannels.id, archivedAt: workChannels.archivedAt })
      .from(workChannels)
      .where(eq(workChannels.id, input.channelId))
      .limit(1)
    if (!channel) throw new WorkWriteError('not_found', '채널을 찾을 수 없습니다')
    if (channel.archivedAt && !input.actorIsAdmin) {
      throw new WorkWriteError('archived', '보관된 채널에는 할 일을 만들 수 없습니다')
    }
    if (!(await memberRole(tx, input.channelId, input.createdBy))) {
      throw new WorkWriteError('forbidden', '채널 멤버만 할 일을 만들 수 있습니다')
    }
    if (input.messageId) {
      const [m] = await tx
        .select({ channelId: workMessages.channelId })
        .from(workMessages)
        .where(eq(workMessages.id, input.messageId))
        .limit(1)
      if (!m || m.channelId !== input.channelId) {
        throw new WorkWriteError('invalid_target', '원본 메시지가 이 채널에 없습니다')
      }
    }
    const now = new Date()
    const done = transition(null, status, input.createdBy, now)
    const newId = crypto.randomUUID()
    await tx.insert(workTasks).values({
      id: newId,
      channelId: input.channelId,
      messageId: input.messageId ?? null,
      title,
      note,
      assigneeId: input.assigneeId ?? null,
      dueOn,
      status,
      createdBy: input.createdBy,
      completedAt: done.completedAt,
      completedBy: done.completedBy,
      createdAt: now,
      updatedAt: now,
    })
    await bumpChannelRev(tx, input.channelId, { tabs: true })
    return newId
  })
  return (await getTaskRecord(id))!
}

export type TaskPatch = {
  title?: string
  note?: string | null
  assigneeId?: string | null
  dueOn?: string | null
  status?: WorkTaskStatus
}

/**
 * 할 일 고치기·완료 토글(원본 updateTask·toggleTaskDone). OLD 행 기준으로 생성자·담당자·채널 owner·관리자만
 * (0036 K1 — 담당자는 담당을 풀거나 넘길 수 있다). 읽기 범위는 호출부가 먼저 본다.
 * 결과: 'updated' | 'not_found' | 'forbidden'.
 */
export async function updateTaskRow(input: {
  id: string
  actorId: string
  actorIsAdmin: boolean
  patch: TaskPatch
}): Promise<'updated' | 'not_found' | 'forbidden'> {
  const p = input.patch
  const set: Partial<typeof workTasks.$inferInsert> = {}
  if (p.title !== undefined) set.title = normalizeTitle(p.title)
  if (p.note !== undefined) set.note = normalizeNote(p.note)
  if (p.assigneeId !== undefined) set.assigneeId = p.assigneeId
  if (p.dueOn !== undefined) set.dueOn = normalizeDue(p.dueOn)
  return db.transaction(async tx => {
    const [row] = await tx
      .select({
        channelId: workTasks.channelId,
        createdBy: workTasks.createdBy,
        assigneeId: workTasks.assigneeId,
        status: workTasks.status,
        completedAt: workTasks.completedAt,
        completedBy: workTasks.completedBy,
        archivedAt: workChannels.archivedAt,
      })
      .from(workTasks)
      .innerJoin(workChannels, eq(workChannels.id, workTasks.channelId))
      .where(eq(workTasks.id, input.id))
      .limit(1)
    if (!row) return 'not_found'
    if (row.archivedAt && !input.actorIsAdmin) {
      throw new WorkWriteError('archived', '보관된 채널의 할 일은 바꿀 수 없습니다')
    }
    const allowed =
      row.createdBy === input.actorId ||
      row.assigneeId === input.actorId ||
      input.actorIsAdmin ||
      (await memberRole(tx, row.channelId, input.actorId)) === 'owner'
    if (!allowed) return 'forbidden'
    const now = new Date()
    if (p.status !== undefined) {
      set.status = p.status
      Object.assign(set, transition(row, p.status, input.actorId, now))
    }
    if (Object.keys(set).length === 0) return 'updated'
    await tx
      .update(workTasks)
      .set({ ...set, updatedAt: now })
      .where(eq(workTasks.id, input.id))
    await bumpChannelRev(tx, row.channelId, { tabs: true })
    return 'updated'
  })
}

/** 할 일 지우기(원본 tasks_delete: 생성자·관리자). 보관 채널은 관리자만. 'deleted' | 'not_found' | 'forbidden' */
export async function deleteTaskRow(input: {
  id: string
  actorId: string
  actorIsAdmin: boolean
}): Promise<'deleted' | 'not_found' | 'forbidden'> {
  return db.transaction(async tx => {
    const [row] = await tx
      .select({
        channelId: workTasks.channelId,
        createdBy: workTasks.createdBy,
        archivedAt: workChannels.archivedAt,
      })
      .from(workTasks)
      .innerJoin(workChannels, eq(workChannels.id, workTasks.channelId))
      .where(eq(workTasks.id, input.id))
      .limit(1)
    if (!row) return 'not_found'
    if (row.archivedAt && !input.actorIsAdmin) {
      throw new WorkWriteError('archived', '보관된 채널의 할 일은 지울 수 없습니다')
    }
    if (row.createdBy !== input.actorId && !input.actorIsAdmin) return 'forbidden'
    await tx.delete(workTasks).where(eq(workTasks.id, input.id))
    await bumpChannelRev(tx, row.channelId, { tabs: true })
    return 'deleted'
  })
}

/** 담당자 후보 계산용: 채널별 멤버 id(원본 listTaskChannelMembers — 읽기 범위는 호출부가 거른 id만 넘긴다) */
export async function listChannelMemberIdsFor(
  channelIds: readonly string[]
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  const ids = [...new Set(channelIds)]
  for (const id of ids) out[id] = []
  for (const part of chunks(ids)) {
    const rows = await db
      .select({ channelId: workChannelMembers.channelId, userId: workChannelMembers.userId })
      .from(workChannelMembers)
      .where(inArray(workChannelMembers.channelId, part))
    for (const r of rows) (out[r.channelId] ??= []).push(r.userId)
  }
  return out
}

/** 메시지 본문(할 일 제목 기본값용 — 같은 채널·지워지지 않은·민감 표시 아닌 것만) */
export async function getMessageForTaskTitle(
  messageId: string,
  channelId: string
): Promise<string | null> {
  const [m] = await db
    .select({
      body: workMessages.body,
      sensitive: workMessages.sensitive,
      deletedAt: workMessages.deletedAt,
    })
    .from(workMessages)
    .where(and(eq(workMessages.id, messageId), eq(workMessages.channelId, channelId)))
    .limit(1)
  if (!m || m.sensitive || m.deletedAt) return null
  return m.body
}
