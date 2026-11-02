/**
 * 대화 메모(`work_conversation_notes`)·저장 이력(`work_note_revisions`) 쿼리 — 원본 kosmart-work 0024의
 * `harden_conversation_notes_write`·`record_conversation_note_revision`과 0033(보관 채널·고아 메모)을 TS로 옮겼다.
 *
 * 권한(누가 읽나)은 모른다 — 호출부가 메모의 채널을 읽을 수 있는지 먼저 본다. 여기서 지키는 데이터 규칙:
 * - 대화당 메모 30개(INSERT), version 1·이력 1건으로 시작
 * - 제목·본문이 **바뀐** 저장만 version+1·updated_by=행위자·updated_at=now, 바뀐 게 없으면 셋 다 그대로
 * - 낙관적 잠금: `where id = ? and version = <기대 버전>` — 그 사이 누가 저장했으면 conflict
 * - 새 버전마다 이력 1건, 메모당 최근 200개만 남긴다(같은 트랜잭션)
 * - id·channel_id·created_at은 바꾸는 함수가 없다(원본 동결)
 * - 쓰는 사람은 그 대화의 멤버(원본 conversation_notes_update USING), 보관 채널은 관리자만(0033 T1)
 * - 메모 생성은 탭과 함께만(`tabs.insertTabRow`) — 이 파일의 `insertNoteInTx`는 그 트랜잭션 안에서만 부른다
 * - 저장마다 `tabs_rev`를 올린다(원본 broadcast_conversation_note_change — 02-sync.md §1)
 */
import { and, desc, eq, lte, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import { memberProfiles, workChannelMembers, workChannels } from '../../schema/index.ts'
import { workConversationNotes, workNoteRevisions } from '../../schema/workTabs.ts'
import { bumpChannelRev, isoNN, WorkWriteError, type WorkExecutor } from './_shared.ts'

export const NOTE_LIMIT_PER_CHANNEL = 30
export const NOTE_TITLE_MAX = 80
export const NOTE_BODY_MAX = 100_000
export const NOTE_REVISION_KEEP = 200

/** 화면 모양(원본 lib/notes/schema.ts NoteData) */
export type WorkNoteRecord = {
  id: string
  channelId: string
  title: string | null
  body: string
  version: number
  updatedAt: string
  updatedByName: string | null
}

export type WorkNoteRevisionMeta = {
  version: number
  editedAt: string
  editedByName: string | null
}

export type WorkNoteRevision = WorkNoteRevisionMeta & { title: string | null; body: string }

/** 원본 `nullif(btrim(title), '')` + conversation_notes_title_len */
export function normalizeNoteTitle(raw: string | null | undefined): string | null {
  const title = (raw ?? '').trim()
  if (title === '') return null
  if (title.length > NOTE_TITLE_MAX) {
    throw new WorkWriteError('invalid', `메모 제목은 ${NOTE_TITLE_MAX}자까지 쓸 수 있습니다`)
  }
  return title
}

function assertBody(body: string): void {
  if (typeof body !== 'string' || body.length > NOTE_BODY_MAX) {
    throw new WorkWriteError('invalid', '메모는 10만 자까지 쓸 수 있습니다')
  }
}

const noteColumns = {
  id: workConversationNotes.id,
  channelId: workConversationNotes.channelId,
  title: workConversationNotes.title,
  body: workConversationNotes.body,
  version: workConversationNotes.version,
  updatedAt: workConversationNotes.updatedAt,
  updatedBy: workConversationNotes.updatedBy,
  updatedByName: memberProfiles.displayName,
}

type NoteSelectRow = {
  id: string
  channelId: string
  title: string | null
  body: string
  version: number
  updatedAt: Date
  updatedByName: string | null
}

function toNote(r: NoteSelectRow): WorkNoteRecord {
  return {
    id: r.id,
    channelId: r.channelId,
    title: r.title,
    body: r.body,
    version: r.version,
    updatedAt: isoNN(r.updatedAt),
    updatedByName: r.updatedByName?.trim() || null,
  }
}

async function selectNote(
  ex: WorkExecutor,
  noteId: string,
  channelId?: string
): Promise<WorkNoteRecord | null> {
  const [row] = await ex
    .select(noteColumns)
    .from(workConversationNotes)
    .leftJoin(memberProfiles, eq(memberProfiles.id, workConversationNotes.updatedBy))
    .where(
      channelId
        ? and(eq(workConversationNotes.id, noteId), eq(workConversationNotes.channelId, channelId))
        : eq(workConversationNotes.id, noteId)
    )
    .limit(1)
  return row ? toNote(row) : null
}

/** 메모 한 건(채널을 주면 그 대화 소속일 때만). 없으면 null. 읽기 범위 판정은 호출부 몫 */
export async function getNoteRecord(
  noteId: string,
  channelId?: string
): Promise<WorkNoteRecord | null> {
  return selectNote(db, noteId, channelId)
}

/** 메모가 속한 대화 id(권한 판정용). 없으면 null */
export async function getNoteChannelId(noteId: string): Promise<string | null> {
  const [row] = await db
    .select({ channelId: workConversationNotes.channelId })
    .from(workConversationNotes)
    .where(eq(workConversationNotes.id, noteId))
    .limit(1)
  return row?.channelId ?? null
}

async function recordRevision(
  tx: WorkExecutor,
  r: {
    noteId: string
    version: number
    title: string | null
    body: string
    editedBy: string | null
    at: Date
  }
): Promise<void> {
  await tx
    .insert(workNoteRevisions)
    .values({
      noteId: r.noteId,
      version: r.version,
      title: r.title,
      body: r.body,
      editedBy: r.editedBy,
      editedAt: r.at,
    })
    .onConflictDoNothing()
  await tx
    .delete(workNoteRevisions)
    .where(
      and(
        eq(workNoteRevisions.noteId, r.noteId),
        lte(workNoteRevisions.version, r.version - NOTE_REVISION_KEEP)
      )
    )
}

/**
 * 메모 만들기 — **탭 추가 트랜잭션 안에서만** 부른다(원본 0033 T2: 메모는 탭과 함께 만든다).
 * 대화당 30개 상한, version 1, 이력 1건(원본 AFTER INSERT 트리거).
 */
export async function insertNoteInTx(
  tx: WorkExecutor,
  input: { channelId: string; title: string | null; body: string; updatedBy: string }
): Promise<{ id: string; version: number }> {
  const title = normalizeNoteTitle(input.title)
  assertBody(input.body)
  const [agg] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(workConversationNotes)
    .where(eq(workConversationNotes.channelId, input.channelId))
  if (Number(agg?.n ?? 0) >= NOTE_LIMIT_PER_CHANNEL) {
    throw new WorkWriteError(
      'limit',
      `메모는 대화당 ${NOTE_LIMIT_PER_CHANNEL}개까지 만들 수 있습니다`
    )
  }
  const id = crypto.randomUUID()
  const now = new Date()
  await tx.insert(workConversationNotes).values({
    id,
    channelId: input.channelId,
    title,
    body: input.body,
    version: 1,
    updatedBy: input.updatedBy,
    updatedAt: now,
    createdAt: now,
  })
  await recordRevision(tx, {
    noteId: id,
    version: 1,
    title,
    body: input.body,
    editedBy: input.updatedBy,
    at: now,
  })
  return { id, version: 1 }
}

export type SaveNoteOutcome =
  | { status: 'saved'; note: WorkNoteRecord }
  | { status: 'conflict'; latest: WorkNoteRecord }

/**
 * 저장(원본 saveNote·revertNote의 `update … where id = ? and version = ?` + harden + 이력).
 * `title`을 주지 않으면 제목은 그대로다(원본 화면은 본문만 저장한다). 메모가 없으면 null.
 * - 행위자는 그 대화의 멤버여야 한다(아니면 forbidden) · 보관 채널은 `canWriteArchived`만
 * - 기대 버전이 다르면 conflict(최신 메모와 함께) · 바뀐 게 없으면 버전·시각·저장자 그대로 saved
 */
export async function saveNoteRow(input: {
  noteId: string
  expectedVersion: number
  body: string
  title?: string | null
  actorId: string
  canWriteArchived: boolean
}): Promise<SaveNoteOutcome | null> {
  assertBody(input.body)
  const nextTitleInput = input.title === undefined ? undefined : normalizeNoteTitle(input.title)
  return db.transaction(async tx => {
    const [head] = await tx
      .select({
        id: workConversationNotes.id,
        channelId: workConversationNotes.channelId,
        title: workConversationNotes.title,
        body: workConversationNotes.body,
        version: workConversationNotes.version,
        archivedAt: workChannels.archivedAt,
      })
      .from(workConversationNotes)
      .innerJoin(workChannels, eq(workChannels.id, workConversationNotes.channelId))
      .where(eq(workConversationNotes.id, input.noteId))
      .limit(1)
    if (!head) return null
    if (head.archivedAt && !input.canWriteArchived) {
      throw new WorkWriteError('archived', '보관된 채널의 메모는 고칠 수 없습니다')
    }
    const [member] = await tx
      .select({ userId: workChannelMembers.userId })
      .from(workChannelMembers)
      .where(
        and(
          eq(workChannelMembers.channelId, head.channelId),
          eq(workChannelMembers.userId, input.actorId)
        )
      )
      .limit(1)
    if (!member) throw new WorkWriteError('forbidden', '대화 멤버만 메모를 고칠 수 있습니다')

    if (head.version !== input.expectedVersion) {
      const latest = await selectNote(tx, head.id)
      return { status: 'conflict', latest: latest! } as const
    }
    const title = nextTitleInput === undefined ? head.title : nextTitleInput
    if (head.body === input.body && head.title === title) {
      return { status: 'saved', note: (await selectNote(tx, head.id))! } as const
    }
    const now = new Date()
    const nextVersion = head.version + 1
    const updated = await tx
      .update(workConversationNotes)
      .set({
        title,
        body: input.body,
        version: nextVersion,
        updatedBy: input.actorId,
        updatedAt: now,
      })
      .where(
        and(
          eq(workConversationNotes.id, head.id),
          eq(workConversationNotes.version, input.expectedVersion)
        )
      )
      .returning({ id: workConversationNotes.id })
    if (updated.length === 0) {
      const latest = await selectNote(tx, head.id)
      return { status: 'conflict', latest: latest! } as const
    }
    await recordRevision(tx, {
      noteId: head.id,
      version: nextVersion,
      title,
      body: input.body,
      editedBy: input.actorId,
      at: now,
    })
    await bumpChannelRev(tx, head.channelId, { tabs: true })
    return { status: 'saved', note: (await selectNote(tx, head.id))! } as const
  })
}

/** 저장 이력(최신 → 오래된, 최대 200) */
export async function listNoteRevisionRows(noteId: string): Promise<WorkNoteRevisionMeta[]> {
  const rows = await db
    .select({
      version: workNoteRevisions.version,
      editedAt: workNoteRevisions.editedAt,
      editedByName: memberProfiles.displayName,
    })
    .from(workNoteRevisions)
    .leftJoin(memberProfiles, eq(memberProfiles.id, workNoteRevisions.editedBy))
    .where(eq(workNoteRevisions.noteId, noteId))
    .orderBy(desc(workNoteRevisions.version))
    .limit(NOTE_REVISION_KEEP)
  return rows.map(r => ({
    version: r.version,
    editedAt: isoNN(r.editedAt),
    editedByName: r.editedByName?.trim() || null,
  }))
}

/** 이력 한 버전의 본문. 없으면(200개 밖으로 밀려났거나 없는 버전) null */
export async function getNoteRevisionRow(
  noteId: string,
  version: number
): Promise<WorkNoteRevision | null> {
  const [r] = await db
    .select({
      version: workNoteRevisions.version,
      title: workNoteRevisions.title,
      body: workNoteRevisions.body,
      editedAt: workNoteRevisions.editedAt,
      editedByName: memberProfiles.displayName,
    })
    .from(workNoteRevisions)
    .leftJoin(memberProfiles, eq(memberProfiles.id, workNoteRevisions.editedBy))
    .where(and(eq(workNoteRevisions.noteId, noteId), eq(workNoteRevisions.version, version)))
    .limit(1)
  if (!r) return null
  return {
    version: r.version,
    title: r.title,
    body: r.body,
    editedAt: isoNN(r.editedAt),
    editedByName: r.editedByName?.trim() || null,
  }
}
