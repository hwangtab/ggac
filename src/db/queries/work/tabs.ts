/**
 * 대화 탭(`work_conversation_tabs`) 쿼리 — 원본 kosmart-work 0023·0024·0025·0026·0033의 트리거를 TS로 옮겼다.
 *
 * 권한은 모른다(누가 탭을 추가·관리할 수 있나는 `src/lib/server/boardWorkTabAuth.ts` → server action이 판정해
 * 플래그로 넘긴다). 대신 원본 BEFORE/AFTER 트리거가 지키던 **데이터 규칙**은 호출부가 무엇을 넘기든 여기서 지킨다:
 *
 * | 원본                                   | 여기                                                       |
 * | -------------------------------------- | ---------------------------------------------------------- |
 * | harden_conversation_tabs_write INSERT  | `insertTabRow` — 제목 trim·1~40자, 대화당 20개, position max+1, 작성자 = 인자(행위자), kind별 검사 |
 * | 〃 UPDATE(id·channel·kind·작성자 동결)   | 바꿀 수 있는 열만 받는 함수(`renameTabRow`·`reorderTabRows`)뿐이다 |
 * | 0025 v_recheck(설정이 그대로면 재검사 생략) | 이름·순서 바꾸기는 config를 건드리지 않으므로 종류별 검사를 다시 하지 않는다 |
 * | website `^https://` · 0033 호스트 끝점 거절 | `assertWebsiteConfig`                                      |
 * | file: 그 대화의 첨부만                  | `attachmentBelongsToChannel`(지워진 메시지의 첨부 제외)      |
 * | note: 그 대화의 메모만 · 메모당 탭 1개    | `assertNoteInChannel` + 부분 유일 인덱스                    |
 * | 할 일 탭 대화당 1개                      | 미리 검사 + 부분 유일 인덱스                                |
 * | delete_note_with_tab(AFTER DELETE)     | `deleteTabRow`가 같은 트랜잭션에서 메모(와 이력 — FK cascade)를 지운다 |
 * | 0033 T1 보관 채널 쓰기 금지(관리자 예외) | `canWriteArchived` 인자                                    |
 * | 0033 T2 고아 메모 금지                   | 메모 탭은 메모와 **같은 트랜잭션**에서 만든다 — 고아 메모가 생길 길이 없다 |
 * | broadcast_conversation_tab_change      | `bumpChannelRev(tx, channelId, { tabs: true })`            |
 */
import { and, asc, count, eq, max, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  workAttachments,
  workChannelMembers,
  workChannels,
  workMessages,
} from '../../schema/index.ts'
import { workConversationNotes, workConversationTabs } from '../../schema/workTabs.ts'
import { bumpChannelRev, isoNN, WorkWriteError, type WorkExecutor } from './_shared.ts'
import { isSqliteUniqueViolation } from './channels.ts'
import { insertSystemMessage } from './messages.ts'
import { insertNoteInTx } from './notes.ts'

/** 원본 conversation_tabs_title_len — 앞뒤 공백을 뗀 1~40자 */
export const TAB_TITLE_MAX = 40
/** 원본 harden_conversation_tabs_write — 대화당 탭 20개 */
export const TAB_LIMIT_PER_CHANNEL = 20
/** 원본 conversation_tabs_config_size — config JSON 4000바이트 */
export const TAB_CONFIG_MAX_BYTES = 4000

/** 이 이식에서 만들 수 있는 종류 — 원본의 'wiki'(위키 미이식)·'timeline'은 없다 */
export const WORK_TAB_KINDS = ['file', 'website', 'tasks', 'note'] as const
export type WorkTabKind = (typeof WORK_TAB_KINDS)[number]

export type WorkTabRecord = {
  id: string
  channel_id: string
  kind: string
  title: string
  position: number
  config: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const tabColumns = {
  id: workConversationTabs.id,
  channelId: workConversationTabs.channelId,
  kind: workConversationTabs.kind,
  title: workConversationTabs.title,
  position: workConversationTabs.position,
  config: workConversationTabs.config,
  createdBy: workConversationTabs.createdBy,
  createdAt: workConversationTabs.createdAt,
  updatedAt: workConversationTabs.updatedAt,
}

type TabSelectRow = {
  id: string
  channelId: string
  kind: string
  title: string
  position: number
  config: unknown
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

function toRecord(r: TabSelectRow): WorkTabRecord {
  const config =
    r.config && typeof r.config === 'object' && !Array.isArray(r.config)
      ? (r.config as Record<string, unknown>)
      : {}
  return {
    id: r.id,
    channel_id: r.channelId,
    kind: r.kind,
    title: r.title,
    position: r.position,
    config,
    created_by: r.createdBy,
    created_at: isoNN(r.createdAt),
    updated_at: isoNN(r.updatedAt),
  }
}

// ── 읽기 ─────────────────────────────────────────────────────────────────────

/** 이 대화의 추가 탭(position → created_at 순). 읽기 범위 판정은 호출부 몫 */
export async function listTabRows(channelId: string): Promise<WorkTabRecord[]> {
  const rows = await db
    .select(tabColumns)
    .from(workConversationTabs)
    .where(eq(workConversationTabs.channelId, channelId))
    .orderBy(asc(workConversationTabs.position), asc(workConversationTabs.createdAt))
  return rows.map(toRecord)
}

/** 탭 한 건. 없으면 null */
export async function getTabRow(tabId: string): Promise<WorkTabRecord | null> {
  const [row] = await db
    .select(tabColumns)
    .from(workConversationTabs)
    .where(eq(workConversationTabs.id, tabId))
    .limit(1)
  return row ? toRecord(row) : null
}

// ── 데이터 규칙(원본 트리거 자리) ────────────────────────────────────────────

/** 원본 `btrim(title)` + conversation_tabs_title_len */
export function normalizeTabTitle(raw: string): string {
  const title = String(raw ?? '').trim()
  if (title.length < 1 || title.length > TAB_TITLE_MAX) {
    throw new WorkWriteError('invalid', `탭 이름은 1~${TAB_TITLE_MAX}자여야 합니다`)
  }
  return title
}

/**
 * 원본 website 검사: `config.url ~* '^https://[^[:space:]]+$'` + 0033 T3 호스트 끝점(`kosmart.org.`) 거절.
 * zod(`normalizeHttpsUrl`)도 같은 규칙이지만 쿼리 층은 그걸 믿지 않는다.
 */
export function assertWebsiteConfig(config: Record<string, unknown>): void {
  const url = typeof config.url === 'string' ? config.url : ''
  if (!/^https:\/\/\S+$/i.test(url)) {
    throw new WorkWriteError('invalid', '웹사이트 탭은 https 주소만 쓸 수 있습니다')
  }
  if (/^https:\/\/[^/?#:]*\.(:[0-9]*)?([/?#]|$)/i.test(url)) {
    throw new WorkWriteError('invalid', '웹사이트 탭은 https 주소만 쓸 수 있습니다')
  }
}

/**
 * 파일 탭의 첨부가 이 대화의 것인가(원본 `exists (select 1 from work.attachments a where a.id = … and a.channel_id = …)`).
 * 2a(첨부 표)가 합쳐져 실제로 본다. 지워진 메시지의 첨부는 원본 `*_live` 정책처럼 없는 것으로 친다.
 * 화면(AddTabDialog)의 파일 탭 선택지·FileTabView 는 3단계(버전)와 함께 켰다.
 */
export async function attachmentBelongsToChannel(
  tx: WorkExecutor,
  attachmentId: string,
  channelId: string
): Promise<boolean> {
  if (!UUID_RE.test(attachmentId)) return false
  const [row] = await tx
    .select({ id: workAttachments.id })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(
      and(
        eq(workAttachments.id, attachmentId),
        eq(workAttachments.channelId, channelId),
        sql`${workMessages.deletedAt} is null`
      )
    )
    .limit(1)
  return row !== undefined
}

async function assertMember(tx: WorkExecutor, channelId: string, userId: string): Promise<void> {
  const [m] = await tx
    .select({ userId: workChannelMembers.userId })
    .from(workChannelMembers)
    .where(and(eq(workChannelMembers.channelId, channelId), eq(workChannelMembers.userId, userId)))
    .limit(1)
  if (!m) throw new WorkWriteError('forbidden', '대화 멤버만 탭을 추가할 수 있습니다')
}

async function loadChannel(tx: WorkExecutor, channelId: string) {
  const [c] = await tx
    .select({ id: workChannels.id, kind: workChannels.kind, archivedAt: workChannels.archivedAt })
    .from(workChannels)
    .where(eq(workChannels.id, channelId))
    .limit(1)
  return c ?? null
}

async function assertChannelWritable(
  tx: WorkExecutor,
  channelId: string,
  canWriteArchived: boolean
): Promise<void> {
  const channel = await loadChannel(tx, channelId)
  if (!channel) throw new WorkWriteError('not_found', '대화를 찾을 수 없습니다')
  if (channel.archivedAt && !canWriteArchived) {
    throw new WorkWriteError('archived', '보관된 채널의 탭은 바꿀 수 없습니다')
  }
}

/** 메모가 이 대화의 것인가(원본 0024 note 검사) */
async function assertNoteInChannel(
  tx: WorkExecutor,
  noteId: unknown,
  channelId: string
): Promise<void> {
  if (typeof noteId !== 'string' || !UUID_RE.test(noteId)) {
    throw new WorkWriteError('invalid_target', '이 대화의 메모만 탭으로 붙일 수 있습니다')
  }
  const [n] = await tx
    .select({ id: workConversationNotes.id })
    .from(workConversationNotes)
    .where(
      and(eq(workConversationNotes.id, noteId), eq(workConversationNotes.channelId, channelId))
    )
    .limit(1)
  if (!n) throw new WorkWriteError('invalid_target', '이 대화의 메모만 탭으로 붙일 수 있습니다')
}

function assertConfigShape(config: Record<string, unknown>): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new WorkWriteError('invalid', '탭 설정이 올바르지 않습니다')
  }
  if (new TextEncoder().encode(JSON.stringify(config)).length > TAB_CONFIG_MAX_BYTES) {
    throw new WorkWriteError('invalid', '탭 설정이 너무 큽니다')
  }
}

// ── 쓰기 ─────────────────────────────────────────────────────────────────────

export type InsertTabInput = {
  channelId: string
  kind: WorkTabKind
  title: string
  /** website `{url, embed}` · file `{attachmentId}` · tasks `{}` · note `{}`(메모를 새로 만든다) 또는 `{noteId}` */
  config: Record<string, unknown>
  /** 행위자(세션의 사용자) — 원본 `new.created_by := auth.uid()` */
  createdBy: string
  /** 보관된 채널에 쓸 수 있나(업무툴 관리자 — 원본 0033 restrictive 정책의 예외) */
  canWriteArchived: boolean
}

/**
 * 탭 추가(원본 addTab의 INSERT + harden_conversation_tabs_write). 메모 탭이면 메모(version 1, 이력 1건)를
 * **같은 트랜잭션에서** 만들고 그 id를 config에 넣는다. 작성자는 그 대화의 멤버여야 한다(원본 conversation_tabs_insert
 * WITH CHECK — 호출부도 먼저 보지만 쓰는 문장 안에서 한 번 더 본다).
 */
export async function insertTabRow(input: InsertTabInput): Promise<WorkTabRecord> {
  if (!(WORK_TAB_KINDS as readonly string[]).includes(input.kind)) {
    throw new WorkWriteError('invalid', '지원하지 않는 탭 종류입니다')
  }
  const title = normalizeTabTitle(input.title)
  return db.transaction(async tx => {
    await assertChannelWritable(tx, input.channelId, input.canWriteArchived)
    await assertMember(tx, input.channelId, input.createdBy)

    const [agg] = await tx
      .select({ n: count(), maxPos: max(workConversationTabs.position) })
      .from(workConversationTabs)
      .where(eq(workConversationTabs.channelId, input.channelId))
    if (Number(agg?.n ?? 0) >= TAB_LIMIT_PER_CHANNEL) {
      throw new WorkWriteError(
        'limit',
        `탭은 대화당 ${TAB_LIMIT_PER_CHANNEL}개까지 추가할 수 있습니다`
      )
    }
    const position = agg?.maxPos == null ? 0 : Number(agg.maxPos) + 1

    let config: Record<string, unknown> = { ...(input.config ?? {}) }
    if (input.kind === 'website') {
      assertWebsiteConfig(config)
      config = { url: config.url, embed: config.embed !== false }
    } else if (input.kind === 'file') {
      const attachmentId = typeof config.attachmentId === 'string' ? config.attachmentId : ''
      if (!(await attachmentBelongsToChannel(tx, attachmentId, input.channelId))) {
        throw new WorkWriteError('invalid_target', '이 대화의 파일만 탭으로 붙일 수 있습니다')
      }
      const history = Array.isArray(config.history) ? config.history : []
      config = { attachmentId, history }
    } else if (input.kind === 'tasks') {
      const [existing] = await tx
        .select({ id: workConversationTabs.id })
        .from(workConversationTabs)
        .where(
          and(
            eq(workConversationTabs.channelId, input.channelId),
            eq(workConversationTabs.kind, 'tasks')
          )
        )
        .limit(1)
      if (existing) throw new WorkWriteError('conflict', '이미 할 일 탭이 있습니다')
      config = {}
    } else {
      // note — 설정에 noteId가 있으면 그 메모(이 대화의 것만), 없으면 새로 만든다
      if (config.noteId !== undefined) {
        await assertNoteInChannel(tx, config.noteId, input.channelId)
        config = { noteId: config.noteId }
      } else {
        const note = await insertNoteInTx(tx, {
          channelId: input.channelId,
          title,
          body: '',
          updatedBy: input.createdBy,
        })
        config = { noteId: note.id }
      }
    }
    assertConfigShape(config)

    const id = crypto.randomUUID()
    const now = new Date()
    try {
      await tx.insert(workConversationTabs).values({
        id,
        channelId: input.channelId,
        kind: input.kind,
        title,
        position,
        config,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      // 부분 유일 인덱스(할 일 탭 1개·메모당 탭 1개) — 미리 본 검사 사이로 끼어든 경우
      if (isSqliteUniqueViolation(e)) {
        throw new WorkWriteError(
          'conflict',
          input.kind === 'tasks' ? '이미 할 일 탭이 있습니다' : '이미 탭으로 붙은 메모입니다'
        )
      }
      throw e
    }
    await bumpChannelRev(tx, input.channelId, { tabs: true })
    return {
      id,
      channel_id: input.channelId,
      kind: input.kind,
      title,
      position,
      config,
      created_by: input.createdBy,
      created_at: isoNN(now),
      updated_at: isoNN(now),
    }
  })
}

/**
 * 이름 바꾸기(원본 conversation_tabs_update — 바꿀 수 있는 열은 title뿐, updated_at=now()).
 * 관리 자격(`can_manage_conversation_tab`)은 호출부가 판정한다. 없으면 null.
 */
export async function renameTabRow(input: {
  tabId: string
  title: string
  canWriteArchived: boolean
}): Promise<WorkTabRecord | null> {
  const title = normalizeTabTitle(input.title)
  return db.transaction(async tx => {
    const [tab] = await tx
      .select(tabColumns)
      .from(workConversationTabs)
      .where(eq(workConversationTabs.id, input.tabId))
      .limit(1)
    if (!tab) return null
    await assertChannelWritable(tx, tab.channelId, input.canWriteArchived)
    if (tab.title === title) return toRecord(tab)
    const now = new Date()
    await tx
      .update(workConversationTabs)
      .set({ title, updatedAt: now })
      .where(eq(workConversationTabs.id, tab.id))
    await bumpChannelRev(tx, tab.channelId, { tabs: true })
    return toRecord({ ...tab, title, updatedAt: now })
  })
}

/**
 * 탭 지우기 + 원본 delete_note_with_tab: 메모 탭이면 가리키던 메모(이 대화의 것만)를 같은 트랜잭션에서 지운다
 * (이력은 FK cascade). 지운 탭을 돌려준다. 없으면 null.
 */
export async function deleteTabRow(input: {
  tabId: string
  canWriteArchived: boolean
}): Promise<WorkTabRecord | null> {
  return db.transaction(async tx => {
    const [tab] = await tx
      .select(tabColumns)
      .from(workConversationTabs)
      .where(eq(workConversationTabs.id, input.tabId))
      .limit(1)
    if (!tab) return null
    await assertChannelWritable(tx, tab.channelId, input.canWriteArchived)
    await tx.delete(workConversationTabs).where(eq(workConversationTabs.id, tab.id))
    const record = toRecord(tab)
    const noteId = record.config.noteId
    if (record.kind === 'note' && typeof noteId === 'string' && UUID_RE.test(noteId)) {
      await tx
        .delete(workConversationNotes)
        .where(
          and(
            eq(workConversationNotes.id, noteId),
            eq(workConversationNotes.channelId, tab.channelId)
          )
        )
    }
    await bumpChannelRev(tx, tab.channelId, { tabs: true })
    return record
  })
}

/**
 * 순서 바꾸기 — 원본 moveTab이 service_role로 position만 갱신하던 자리. 이 대화의 탭에만(channel_id 조건) 적용하고,
 * 바뀐 것이 있으면 tabs_rev를 한 번 올린다. 적용한 행 수를 돌려준다.
 */
export async function reorderTabRows(input: {
  channelId: string
  changes: readonly { id: string; position: number }[]
  canWriteArchived: boolean
}): Promise<number> {
  if (input.changes.length === 0) return 0
  return db.transaction(async tx => {
    await assertChannelWritable(tx, input.channelId, input.canWriteArchived)
    let applied = 0
    for (const c of input.changes) {
      const rows = await tx
        .update(workConversationTabs)
        .set({ position: c.position })
        .where(
          and(
            eq(workConversationTabs.id, c.id),
            eq(workConversationTabs.channelId, input.channelId)
          )
        )
        .returning({ id: workConversationTabs.id })
      applied += rows.length
    }
    if (applied > 0) await bumpChannelRev(tx, input.channelId, { tabs: true })
    return applied
  })
}

/**
 * "게시물에 알리기" 시스템 메시지(원본 addTab이 service_role로 넣던 것 — 곁가지라 탭 추가와 다른 트랜잭션).
 * 공지 채널 판정은 호출부 몫이다.
 */
export async function insertTabAnnouncement(input: {
  channelId: string
  authorId: string
  body: string
}): Promise<void> {
  await db.transaction(tx => insertSystemMessage(tx, input))
}

/** 테스트·진단용: 그 대화의 탭 수 */
export async function countTabRows(channelId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(workConversationTabs)
    .where(eq(workConversationTabs.channelId, channelId))
  return Number(row?.n ?? 0)
}
