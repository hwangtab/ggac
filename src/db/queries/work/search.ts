/**
 * 업무툴 통합 검색 쿼리 계층 — 원본 kosmart-work RPC `search_messages`·`search_attachments`(0005),
 * `search_attachment_texts`(0029), `search_notes`(0024·0039)와 그 ilike 폴백을 옮겼다(설계 §8-3).
 *
 * **권한을 모른다.** 원본은 security invoker RPC 라 호출자의 RLS(can_read_channel·attachment_is_live)가 걸렀다.
 * 여기서는 호출부가 계산한 읽기 범위(`readable` — 원본 readable_channel_ids)를 받아 **모든 쿼리의 WHERE 에 넣는다.**
 * 읽기 범위를 빠뜨린 검색 함수는 비공개 채널·남의 DM 본문을 그대로 내보낸다 — 새 함수를 더할 때 `scopeOn`을 먼저 건다.
 *
 * 일치 규칙(원본 pgroonga `&@~ "a" "b"`의 1단계 대체 — §8-3):
 * - 검색어(≤8개, `splitTerms`)마다 `instr(lower(열), lower(검색어)) > 0`을 AND 로 잇는다. LIKE 가 아니라서 `%`·`_`를
 *   이스케이프할 필요가 없고, 두 글자 한국어(예: "정관")도 그대로 잡힌다(FTS5 trigram 은 세 글자 미만을 못 잡는다).
 * - SQLite `lower()`는 ASCII 만 접는다 — 한글은 대소문자가 없어 문제없고, 라틴 확장 문자의 대소문자는 구분된다.
 * - 지워진 메시지(`deleted_at`)와 그 첨부·첨부 본문은 나오지 않는다(원본 RPC·attachment_is_live).
 */
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { db } from '../../client.ts'
import {
  workAttachments,
  workAttachmentTexts,
  workChannels,
  workConversationNotes,
  workConversationTabs,
  workMessages,
} from '../../schema/index.ts'

import { chunks, isoNN } from './_shared.ts'

export type ReadableScope = ReadonlySet<string>

/** 검색어 상한(원본 splitTerms 와 같다) */
export const SEARCH_MAX_TERMS = 8

/** 원본 RPC 상한 — search_messages 100 · search_attachments 100 · search_attachment_texts 50 · search_notes 50 */
const LIMIT_MAX = { messages: 100, files: 100, documents: 50, notes: 50 } as const

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  const n = Math.floor(limit ?? fallback)
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, 1), max)
}

/** 읽기 범위 조건. 비면 거짓 조건(빈 IN 대신) */
function scopeOn(column: AnySQLiteColumn, readable: ReadableScope) {
  const ids = [...readable]
  return ids.length > 0 ? inArray(column, ids) : sql`0`
}

function cleanTerms(terms: readonly string[]): string[] {
  return terms
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, SEARCH_MAX_TERMS)
}

/** 검색어마다 `instr(lower(열), lower(?)) > 0` — 전부 AND */
function allTermsIn(column: SQL | AnySQLiteColumn, terms: readonly string[]) {
  return and(...terms.map(t => sql`instr(lower(${column}), lower(${t})) > 0`))
}

export type SearchRange = {
  /** 포함 */
  from?: Date | null
  /** 배타 */
  to?: Date | null
}

// ── 메시지 ────────────────────────────────────────────────────────────────────

export type MessageSearchRow = {
  id: string
  channel_id: string
  parent_id: string | null
  author_id: string | null
  kind: string
  body: string
  sensitive: boolean
  created_at: string
}

const messageColumns = {
  id: workMessages.id,
  channelId: workMessages.channelId,
  parentId: workMessages.parentId,
  authorId: workMessages.authorId,
  kind: workMessages.kind,
  body: workMessages.body,
  sensitive: workMessages.sensitive,
  createdAt: workMessages.createdAt,
}

type MessageSelect = {
  id: string
  channelId: string
  parentId: string | null
  authorId: string | null
  kind: string
  body: string
  sensitive: boolean
  createdAt: Date
}

function toMessageRow(r: MessageSelect): MessageSearchRow {
  return {
    id: r.id,
    channel_id: r.channelId,
    parent_id: r.parentId,
    author_id: r.authorId,
    kind: r.kind,
    body: r.body,
    sensitive: r.sensitive,
    created_at: isoNN(r.createdAt),
  }
}

/**
 * 메시지 본문 검색(원본 search_messages). 검색어가 없으면 작성자 둘러보기(원본 browseAuthorMessages —
 * 그때는 authorId 가 있어야 하고, 없으면 빈 목록이다). 최신 순(created_at·id 내림차순).
 */
export async function searchMessageRows(opts: {
  readable: ReadableScope
  terms: readonly string[]
  channelId?: string | null
  authorId?: string | null
  range?: SearchRange
  limit?: number
}): Promise<MessageSearchRow[]> {
  const terms = cleanTerms(opts.terms)
  if (terms.length === 0 && !opts.authorId) return []
  const rows = await db
    .select(messageColumns)
    .from(workMessages)
    .where(
      and(
        scopeOn(workMessages.channelId, opts.readable),
        isNull(workMessages.deletedAt),
        terms.length > 0 ? allTermsIn(workMessages.body, terms) : undefined,
        opts.channelId ? eq(workMessages.channelId, opts.channelId) : undefined,
        opts.authorId ? eq(workMessages.authorId, opts.authorId) : undefined,
        opts.range?.from ? gte(workMessages.createdAt, opts.range.from) : undefined,
        opts.range?.to ? lt(workMessages.createdAt, opts.range.to) : undefined
      )
    )
    .orderBy(desc(workMessages.createdAt), desc(workMessages.id))
    .limit(clampLimit(opts.limit, 50, LIMIT_MAX.messages))
  return rows.map(toMessageRow)
}

// ── 파일 이름 ─────────────────────────────────────────────────────────────────

export type FileSearchRow = {
  id: string
  message_id: string
  channel_id: string
  name: string
  mime: string
  size: number
  created_at: string
}

/** 첨부 파일명 검색(원본 search_attachments + RLS attachments_select). 지워진 메시지의 첨부는 빼고, 버전은 전부 나온다 */
export async function searchFileNameRows(opts: {
  readable: ReadableScope
  terms: readonly string[]
  channelId?: string | null
  range?: SearchRange
  limit?: number
}): Promise<FileSearchRow[]> {
  const terms = cleanTerms(opts.terms)
  if (terms.length === 0) return []
  const rows = await db
    .select({
      id: workAttachments.id,
      messageId: workAttachments.messageId,
      channelId: workAttachments.channelId,
      name: workAttachments.name,
      mime: workAttachments.mime,
      size: workAttachments.size,
      createdAt: workAttachments.createdAt,
    })
    .from(workAttachments)
    .innerJoin(
      workMessages,
      and(eq(workMessages.id, workAttachments.messageId), isNull(workMessages.deletedAt))
    )
    .where(
      and(
        scopeOn(workAttachments.channelId, opts.readable),
        allTermsIn(workAttachments.name, terms),
        opts.channelId ? eq(workAttachments.channelId, opts.channelId) : undefined,
        opts.range?.from ? gte(workAttachments.createdAt, opts.range.from) : undefined,
        opts.range?.to ? lt(workAttachments.createdAt, opts.range.to) : undefined
      )
    )
    .orderBy(desc(workAttachments.createdAt), desc(workAttachments.id))
    .limit(clampLimit(opts.limit, 60, LIMIT_MAX.files))
  return rows.map(r => ({
    id: r.id,
    message_id: r.messageId,
    channel_id: r.channelId,
    name: r.name,
    mime: r.mime,
    size: r.size,
    created_at: isoNN(r.createdAt),
  }))
}

// ── 문서 본문 ─────────────────────────────────────────────────────────────────

/** 본문에서 첫 일치 앞쪽으로 남기는 글자 수 — 스니펫(makeSnippet, 200자)이 앞 문맥을 1/3 쓴다 */
export const DOCUMENT_WINDOW_BEFORE = 120
/** 본문 창 길이 — 화면 스니펫(200자)보다 넉넉히. 2,000,000자 본문 전체를 앱으로 끌어오지 않는다 */
export const DOCUMENT_WINDOW_CHARS = 600

export type DocumentSearchRow = FileSearchRow & {
  /** 첫 일치 주변의 원문 창(평문). 화면 스니펫은 호출부가 makeSnippet 으로 다듬는다 */
  window: string
  /** 창이 본문 맨 앞에서 시작하는가(앞 생략 표시용) */
  window_at_start: boolean
  /** 창 뒤에 본문이 더 있는가 */
  window_has_more: boolean
  truncated: boolean
}

/**
 * 첨부 본문 검색(원본 search_attachment_texts + RLS attachment_texts_select). 추출 상태 ok 만, 지워진 메시지의 첨부는
 * 빼고, 읽기 범위는 **첨부의 채널**로 본다(결과 행의 channel_id 는 쓰기 함수가 첨부의 채널로만 적지만, 판정은 첨부 쪽).
 * 스니펫은 SQL 이 첫 일치 주변의 창만 잘라 돌려준다(원본은 앞 60자 + 200자 창).
 */
export async function searchDocumentRows(opts: {
  readable: ReadableScope
  terms: readonly string[]
  channelId?: string | null
  range?: SearchRange
  limit?: number
}): Promise<DocumentSearchRow[]> {
  const terms = cleanTerms(opts.terms)
  if (terms.length === 0) return []
  const content = workAttachmentTexts.content
  const positions = terms.map(t => sql`instr(lower(${content}), lower(${t}))`)
  // SQLite min(x)는 인자 하나면 집계 함수다 — 둘 이상일 때만 스칼라 min
  const first = positions.length === 1 ? positions[0] : sql`min(${sql.join(positions, sql`, `)})`
  const start = sql`max(${first} - ${DOCUMENT_WINDOW_BEFORE}, 1)`
  const rows = await db
    .select({
      id: workAttachments.id,
      messageId: workAttachments.messageId,
      channelId: workAttachments.channelId,
      name: workAttachments.name,
      mime: workAttachments.mime,
      size: workAttachments.size,
      createdAt: workAttachments.createdAt,
      truncated: workAttachmentTexts.truncated,
      window: sql<string>`substr(${content}, ${start}, ${DOCUMENT_WINDOW_CHARS})`,
      windowStart: sql<number>`${start}`,
      contentLength: sql<number>`length(${content})`,
    })
    .from(workAttachmentTexts)
    .innerJoin(workAttachments, eq(workAttachments.id, workAttachmentTexts.attachmentId))
    .innerJoin(
      workMessages,
      and(eq(workMessages.id, workAttachments.messageId), isNull(workMessages.deletedAt))
    )
    .where(
      and(
        scopeOn(workAttachments.channelId, opts.readable),
        eq(workAttachmentTexts.status, 'ok'),
        allTermsIn(content, terms),
        opts.channelId ? eq(workAttachments.channelId, opts.channelId) : undefined,
        opts.range?.from ? gte(workAttachments.createdAt, opts.range.from) : undefined,
        opts.range?.to ? lt(workAttachments.createdAt, opts.range.to) : undefined
      )
    )
    .orderBy(desc(workAttachments.createdAt), desc(workAttachments.id))
    .limit(clampLimit(opts.limit, 50, LIMIT_MAX.documents))
  return rows.map(r => {
    const startAt = Number(r.windowStart)
    const window = r.window ?? ''
    return {
      id: r.id,
      message_id: r.messageId,
      channel_id: r.channelId,
      name: r.name,
      mime: r.mime,
      size: r.size,
      created_at: isoNN(r.createdAt),
      window,
      window_at_start: startAt <= 1,
      window_has_more: startAt - 1 + window.length < Number(r.contentLength),
      truncated: r.truncated,
    }
  })
}

// ── 메모 ──────────────────────────────────────────────────────────────────────

export type NoteSearchRow = {
  id: string
  channel_id: string
  tab_id: string
  title: string | null
  body: string
  updated_at: string
}

/**
 * 메모 탭 본문·제목 검색(원본 search_notes 0039). 메모 탭(kind 'note', config.noteId)이 가리키는 메모만 나온다.
 * 원본은 "모든 검색어가 본문에" 또는 "모든 검색어가 제목에"였다. 여기서는 검색어마다 본문 또는 제목에 있으면 된다
 * (제목에 한 낱말, 본문에 다른 낱말이 있는 메모도 잡는다 — 좁히는 쪽이 아니라 넓히는 쪽이라 권한과 무관하다).
 */
export async function searchNoteRows(opts: {
  readable: ReadableScope
  terms: readonly string[]
  channelId?: string | null
  range?: SearchRange
  limit?: number
}): Promise<NoteSearchRow[]> {
  const terms = cleanTerms(opts.terms)
  if (terms.length === 0) return []
  const n = workConversationNotes
  const rows = await db
    .select({
      id: n.id,
      channelId: n.channelId,
      tabId: workConversationTabs.id,
      title: n.title,
      body: n.body,
      updatedAt: n.updatedAt,
    })
    .from(n)
    .innerJoin(
      workConversationTabs,
      and(
        eq(workConversationTabs.kind, 'note'),
        eq(workConversationTabs.channelId, n.channelId),
        sql`(${workConversationTabs.config} ->> '$.noteId') = ${n.id}`
      )
    )
    .where(
      and(
        scopeOn(n.channelId, opts.readable),
        ...terms.map(
          t =>
            sql`(instr(lower(${n.body}), lower(${t})) > 0 or instr(lower(coalesce(${n.title}, '')), lower(${t})) > 0)`
        ),
        opts.channelId ? eq(n.channelId, opts.channelId) : undefined,
        opts.range?.from ? gte(n.updatedAt, opts.range.from) : undefined,
        opts.range?.to ? lt(n.updatedAt, opts.range.to) : undefined
      )
    )
    .orderBy(desc(n.updatedAt), desc(n.id))
    .limit(clampLimit(opts.limit, 21, LIMIT_MAX.notes))
  return rows.map(r => ({
    id: r.id,
    channel_id: r.channelId,
    tab_id: r.tabId,
    title: r.title,
    body: r.body,
    updated_at: isoNN(r.updatedAt),
  }))
}

// ── 결과를 꾸미는 조회 ────────────────────────────────────────────────────────

export type SearchChannelRow = {
  id: string
  name: string
  slug: string | null
  kind: 'public' | 'private' | 'dm'
}

function kindOf(kind: string): SearchChannelRow['kind'] {
  return kind === 'private' || kind === 'dm' ? kind : 'public'
}

/** 결과에 붙일 채널(읽기 범위 안만 — 범위 밖 id 는 결과에 없다) */
export async function getSearchChannels(
  ids: readonly string[],
  readable: ReadableScope
): Promise<Map<string, SearchChannelRow>> {
  const map = new Map<string, SearchChannelRow>()
  const list = [...new Set(ids)].filter(id => readable.has(id))
  for (const part of chunks(list)) {
    const rows = await db
      .select({
        id: workChannels.id,
        name: workChannels.name,
        slug: workChannels.slug,
        kind: workChannels.kind,
      })
      .from(workChannels)
      .where(inArray(workChannels.id, part))
    for (const r of rows) map.set(r.id, { ...r, kind: kindOf(r.kind) })
  }
  return map
}

/** 검색 필터 select 용: 읽기 범위 안의 채널(DM 제외), 이름순 */
export async function listSearchFilterChannels(
  readable: ReadableScope
): Promise<SearchChannelRow[]> {
  const ids = [...readable]
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: workChannels.id,
      name: workChannels.name,
      slug: workChannels.slug,
      kind: workChannels.kind,
    })
    .from(workChannels)
    .where(and(inArray(workChannels.id, ids), ne(workChannels.kind, 'dm')))
  return rows
    .map(r => ({ ...r, kind: kindOf(r.kind) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/** 메시지 id → 스레드 부모·민감 여부(읽기 범위 안만). 버전 게시물·스레드 첨부는 답글이라 링크에 ?thread= 가 필요하다 */
export async function getSearchMessageMeta(
  ids: readonly string[],
  readable: ReadableScope
): Promise<Map<string, { parentId: string | null; sensitive: boolean }>> {
  const map = new Map<string, { parentId: string | null; sensitive: boolean }>()
  const list = [...new Set(ids)]
  for (const part of chunks(list)) {
    const rows = await db
      .select({
        id: workMessages.id,
        parentId: workMessages.parentId,
        sensitive: workMessages.sensitive,
      })
      .from(workMessages)
      .where(and(inArray(workMessages.id, part), scopeOn(workMessages.channelId, readable)))
    for (const r of rows) map.set(r.id, { parentId: r.parentId, sensitive: r.sensitive })
  }
  return map
}

export type SearchLineageRow = { root: string; versionNo: number; isLatest: boolean }

/** 첨부 id → 계보 정보(원본 loadLineageInfo 의 select, 읽기 범위 안만) */
export async function getSearchLineageInfo(
  ids: readonly string[],
  readable: ReadableScope
): Promise<Map<string, SearchLineageRow>> {
  const map = new Map<string, SearchLineageRow>()
  for (const part of chunks([...new Set(ids)])) {
    const rows = await db
      .select({
        id: workAttachments.id,
        versionRootId: workAttachments.versionRootId,
        versionNo: workAttachments.versionNo,
        isLatest: workAttachments.isLatest,
      })
      .from(workAttachments)
      .where(and(inArray(workAttachments.id, part), scopeOn(workAttachments.channelId, readable)))
    for (const r of rows) {
      map.set(r.id, {
        root: r.versionRootId ?? r.id,
        versionNo: r.versionNo,
        isLatest: r.isLatest === true,
      })
    }
  }
  return map
}
