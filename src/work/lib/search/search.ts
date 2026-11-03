import {
  getSearchChannels,
  getSearchMessageMeta,
  listSearchFilterChannels,
  searchFileNameRows,
  searchMessageRows,
  searchNoteRows,
  type ReadableScope,
  type SearchRange,
} from '@/db/queries/work/search'
import { getDisplayNames } from '@/db/queries/work/directory'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { listStaffDirectory } from '@work/lib/channels/queries'
import { messageLink } from '@work/lib/messages/anchor'
import { authorLabel } from '@work/lib/messages/author-label'
import type { WorkServerClient } from '@work/lib/supabase/server'
import type { Database } from '@work/types/supabase'
import { conversationBasePath } from '@work/lib/tabs/paths'
import {
  DOCUMENT_FETCH,
  DOCUMENT_LIMIT,
  mergeDocumentHits,
  searchDocumentRows,
  type RawDocumentRow,
} from './documents'
import { collapseByLineage, loadLineageInfo } from './lineage'
import { dateRangeToIso, type SearchParams } from './params'
import { splitTerms } from './text'

/**
 * 통합 검색 — 메시지 · 파일명 · 문서 내용 · 메모 · 사람. 원본 kosmart-work `lib/search/search.ts`와 **같은 이름·결과 모양**.
 *
 * ggac 이식(설계 §8-3) — 다시 쓴 곳:
 * - 원본은 호출자의 RLS 클라이언트로 pgroonga RPC 를 부르고(실패하면 ilike 폴백) RLS 가 읽을 수 없는 채널을 걸렀다.
 *   여기서는 첫 인자(가드 결과)로 읽기 범위(원본 readable_channel_ids)를 **한 번** 계산해 모든 쿼리(`src/db/queries/work/
 *   search.ts`)에 넘긴다. 검색은 늘 `instr(lower(…))` AND 다 — 원본의 'ilike' 모드(간이 검색 안내)와 같은 일치 규칙이라
 *   모드는 'ilike' 하나다(안내 배너는 화면에서 뺐다).
 * - 기간 필터는 파일·문서·메모에도 SQL 에서 정확히 건다(원본은 RPC 에 기간 인자가 없어 상위 결과 안에서만 걸렀다).
 *   그래서 `dateFiltered`(상위 결과 안에서만 걸렀다는 안내)는 늘 false 다.
 * - 사람 검색은 staff 표 대신 업무툴 사람 목록(`listStaffDirectory` — 지금 이사·감사·관리자)에서 이름으로 찾는다.
 * 결과 상한(메시지 50 · 파일 20 · 문서 20 · 메모 20 · 사람 10)과 "더 있음" 판정은 원본 그대로다.
 */

type ChannelKind = Database['work']['Enums']['channel_kind']

/** browse = 검색어 없이 작성자만으로 그 사람의 메시지를 모아 보는 경우(사람 결과를 눌렀을 때) */
export type SearchMode = 'pgroonga' | 'ilike' | 'browse'

export type ChannelRef = { id: string; name: string; slug: string | null; kind: ChannelKind }

export type MessageHit = {
  id: string
  channelId: string
  parentId: string | null
  authorId: string | null
  /** 사람은 표시 이름, 봇/시스템(author_id null)은 authorLabel 규칙의 라벨 */
  authorName: string | null
  kind: string | null
  /** 민감 메시지는 본문을 비운다(sensitive=true) — 화면은 안내 문구만 보인다 */
  body: string
  sensitive: boolean
  createdAt: string
  channel: ChannelRef | null
  href: string
}

export type FileHit = {
  id: string
  messageId: string
  channelId: string
  name: string
  mime: string
  size: number
  createdAt: string
  channel: ChannelRef | null
  href: string
  /** 파일명과 본문이 모두 맞은 파일이면 본문 일치 부분(평문) */
  snippet?: string
  /** 최신이 아닌 버전이 맞은 경우 그 번호(같은 문서의 최신 버전은 이 검색어와 맞지 않았다) */
  oldVersionNo?: number
}

/** 문서 본문(HWP·DOCX·XLSX·PDF·텍스트)에서만 찾은 첨부 — 파일명은 맞지 않았다(0029) */
export type DocumentHit = {
  id: string
  messageId: string
  channelId: string
  name: string
  mime: string
  size: number
  createdAt: string
  /** 일치 부분 앞뒤 문맥(평문 — Highlight 로만 그린다) */
  snippet: string
  channel: ChannelRef | null
  /** 이 첨부가 달린 메시지로 가는 링크 */
  href: string
  /** 최신이 아닌 버전이 맞은 경우 그 번호 */
  oldVersionNo?: number
}

/** 메모 탭 본문 검색 결과(0024). 메모 탭이 있는 메모만 나온다 */
export type NoteHit = {
  id: string
  channelId: string
  tabId: string
  title: string | null
  body: string
  updatedAt: string
  channel: ChannelRef | null
  href: string
}

export type PersonHit = { userId: string; displayName: string; title: string | null }

/** 구역별 상한에서 잘렸는지(상한+1 로 조회해 판정) — 화면이 "더 있음" 안내를 낸다 */
export type SearchMore = {
  messages: boolean
  files: boolean
  documents: boolean
  notes: boolean
  people: boolean
}

export type SearchResult = {
  mode: SearchMode
  terms: string[]
  messages: MessageHit[]
  files: FileHit[]
  /** 본문에서만 찾은 문서(파일명 결과와 중복 제거됨) */
  documents: DocumentHit[]
  people: PersonHit[]
  notes: NoteHit[]
  /** 상한에서 잘린 구역 */
  more?: SearchMore
  /** 기간 필터가 상위 결과 안에서만 걸렸는가 — ggac 는 SQL 에서 정확히 걸어 늘 false */
  dateFiltered?: boolean
}

export const EMPTY_RESULT: SearchResult = {
  mode: 'ilike',
  terms: [],
  messages: [],
  files: [],
  documents: [],
  people: [],
  notes: [],
  more: { messages: false, files: false, documents: false, notes: false, people: false },
  dateFiltered: false,
}

const MESSAGE_LIMIT = 50
const FILE_LIMIT = 20
/** 같은 문서의 여러 버전이 한 계보로 묶여 줄어드는 만큼을 메우려고 더 가져온다(원본 RPC 상한 100) */
const FILE_FETCH = FILE_LIMIT * 3
const PEOPLE_LIMIT = 10
const NOTE_LIMIT = 20

/**
 * 결과 → 이동 경로. 채널은 /c/<slug>, DM 은 /dm/<channelId>. 메시지 앵커 #msg-<id>.
 * 스레드 답글(parentId)이면 ?thread=<parentId> — 채널 화면이 스레드 패널을 열고 답글을 강조한다(QA #2).
 */
export function messageHref(
  channel: ChannelRef | null,
  channelId: string,
  messageId: string,
  parentId?: string | null
) {
  return messageLink({
    channelId,
    kind: channel?.kind ?? null,
    slug: channel?.slug ?? null,
    messageId,
    parentId,
  })
}

/** 파일 결과 → 자료실 링크(파일 영역이 channel·q 쿼리를 해석한다). */
export function fileHref(channelId: string, name: string) {
  return `/files?${new URLSearchParams({ channel: channelId, q: name }).toString()}`
}

async function scope(supabase: WorkServerClient): Promise<ReadableScope> {
  return readableChannelIds(viewerOf(supabase))
}

function rangeOf(p: Pick<SearchParams, 'from' | 'to'>): SearchRange {
  const { fromIso, toIso } = dateRangeToIso(p.from, p.to)
  return { from: fromIso ? new Date(fromIso) : null, to: toIso ? new Date(toIso) : null }
}

/** 사람 검색 — 활성 구성원 중 이름에 모든 검색어가 든 사람(이름순, 상한+1) */
async function searchPeople(supabase: WorkServerClient, terms: string[]): Promise<PersonHit[]> {
  const lower = terms.map(t => t.toLowerCase())
  const people = await listStaffDirectory(supabase)
  return people
    .filter(p => p.status === 'active')
    .filter(p => lower.every(t => p.display_name.toLowerCase().includes(t)))
    .slice(0, PEOPLE_LIMIT + 1)
    .map(p => ({ userId: p.user_id, displayName: p.display_name, title: p.title }))
}

function toDocumentHit(
  d: RawDocumentRow & { oldVersionNo?: number },
  channel: ChannelRef | null,
  parentId: string | null = null
): DocumentHit {
  return {
    id: d.id,
    messageId: d.message_id,
    channelId: d.channel_id,
    name: d.name,
    mime: d.mime,
    size: d.size,
    createdAt: d.created_at,
    snippet: d.snippet,
    channel,
    href: messageHref(channel, d.channel_id, d.message_id, parentId),
    ...(d.oldVersionNo !== undefined ? { oldVersionNo: d.oldVersionNo } : {}),
  }
}

export async function searchAll(
  supabase: WorkServerClient,
  params: SearchParams
): Promise<SearchResult> {
  const terms = splitTerms(params.q)
  const browse = terms.length === 0 && Boolean(params.author)
  if (terms.length === 0 && !browse) return { ...EMPTY_RESULT }

  const readable = await scope(supabase)
  const range = rangeOf(params)

  // 작성자 필터가 있으면 파일·사람 검색은 의미가 없다(메시지만).
  const messagesOnly = Boolean(params.author)
  const [msgRowsAll, fileRowsRaw, peopleRaw, noteRowsAll, docRowsRaw] = await Promise.all([
    searchMessageRows({
      readable,
      terms: browse ? [] : terms,
      channelId: params.channel,
      authorId: params.author,
      range,
      limit: MESSAGE_LIMIT + 1,
    }),
    messagesOnly
      ? Promise.resolve([])
      : searchFileNameRows({
          readable,
          terms,
          channelId: params.channel,
          range,
          limit: FILE_FETCH,
        }),
    messagesOnly ? Promise.resolve<PersonHit[]>([]) : searchPeople(supabase, terms),
    messagesOnly
      ? Promise.resolve([])
      : searchNoteRows({
          readable,
          terms,
          channelId: params.channel,
          range,
          limit: NOTE_LIMIT + 1,
        }),
    messagesOnly
      ? Promise.resolve<RawDocumentRow[]>([])
      : searchDocumentRows(readable, params.q, {
          channelId: params.channel,
          from: range.from,
          to: range.to,
        }),
  ])

  // 같은 문서의 버전은 한 건으로 묶는다(최신이 맞았으면 최신, 아니면 이전 버전 표시)
  const lineage = await loadLineageInfo(readable, [
    ...fileRowsRaw.map(f => f.id),
    ...docRowsRaw.map(d => d.id),
  ])
  const fileCollapsed = collapseByLineage(fileRowsRaw, lineage)
  const fileRowsOne = fileCollapsed.slice(0, FILE_LIMIT)
  const fileIdSet = new Set(fileRowsOne.map(f => f.id))
  const fileRoots = new Set(fileRowsOne.map(f => lineage.get(f.id)?.root ?? f.id))
  const docCollapsed = collapseByLineage(docRowsRaw, lineage).filter(
    d => fileIdSet.has(d.id) || !fileRoots.has(lineage.get(d.id)?.root ?? d.id)
  )
  const docRowsOne = docCollapsed.slice(0, DOCUMENT_LIMIT)

  const msgRows = msgRowsAll.slice(0, MESSAGE_LIMIT)
  const noteRows = noteRowsAll.slice(0, NOTE_LIMIT)
  const people = peopleRaw.slice(0, PEOPLE_LIMIT)
  const more: SearchMore = {
    messages: msgRowsAll.length > MESSAGE_LIMIT,
    // 가져오는 상한(FILE_FETCH·DOCUMENT_FETCH)에 닿았으면 더 있을 수 있다
    files: fileCollapsed.length > FILE_LIMIT || fileRowsRaw.length >= FILE_FETCH,
    documents: docCollapsed.length > DOCUMENT_LIMIT || docRowsRaw.length >= DOCUMENT_FETCH,
    notes: noteRowsAll.length > NOTE_LIMIT,
    people: peopleRaw.length > PEOPLE_LIMIT,
  }

  const [channels, authors, metas] = await Promise.all([
    getSearchChannels(
      [
        ...msgRows.map(m => m.channel_id),
        ...fileRowsOne.map(f => f.channel_id),
        ...noteRows.map(n => n.channel_id),
        ...docRowsOne.map(d => d.channel_id),
      ],
      readable
    ),
    getDisplayNames(msgRows.map(m => m.author_id).filter((id): id is string => id !== null)),
    getSearchMessageMeta(
      docRowsOne.map(d => d.message_id),
      readable
    ),
  ])

  const messages: MessageHit[] = msgRows.map(m => {
    const channel = channels.get(m.channel_id) ?? null
    return {
      id: m.id,
      channelId: m.channel_id,
      parentId: m.parent_id,
      authorId: m.author_id,
      authorName: m.author_id
        ? (authors.get(m.author_id) ?? null)
        : authorLabel({ kind: m.kind, body: m.body }),
      kind: m.kind,
      body: m.sensitive ? '' : m.body,
      sensitive: m.sensitive,
      createdAt: m.created_at,
      channel,
      href: messageHref(channel, m.channel_id, m.id, m.parent_id),
    }
  })

  const files: FileHit[] = fileRowsOne.map(f => ({
    id: f.id,
    messageId: f.message_id,
    channelId: f.channel_id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    createdAt: f.created_at,
    channel: channels.get(f.channel_id) ?? null,
    href: fileHref(f.channel_id, f.name),
    ...(f.oldVersionNo !== undefined ? { oldVersionNo: f.oldVersionNo } : {}),
  }))

  const docHits = docRowsOne.map(d =>
    toDocumentHit(d, channels.get(d.channel_id) ?? null, metas.get(d.message_id)?.parentId ?? null)
  )
  const merged = mergeDocumentHits(files, docHits, d => d.snippet)

  const notes: NoteHit[] = noteRows.map(n => {
    const channel = channels.get(n.channel_id) ?? null
    return {
      id: n.id,
      channelId: n.channel_id,
      tabId: n.tab_id,
      title: n.title,
      body: n.body,
      updatedAt: n.updated_at,
      channel,
      href: channel
        ? `${conversationBasePath(channel)}/t/${n.tab_id}`
        : `/dm/${n.channel_id}/t/${n.tab_id}`,
    }
  })

  return {
    mode: browse ? 'browse' : 'ilike',
    terms,
    messages,
    files: merged.files,
    documents: merged.documents,
    people,
    notes,
    more,
    dateFiltered: false,
  }
}

/**
 * 채널 파일 탭 검색용: 이 채널 첨부의 본문에서만 찾은 문서. 이미 파일명 검색 결과에 있는 첨부(excludeIds)는 뺀다.
 * 읽을 수 없는 채널이면 빈 목록이다(읽기 범위 안에서만 찾는다).
 */
export async function loadChannelDocumentHits(
  supabase: WorkServerClient,
  channel: ChannelRef,
  q: string,
  excludeIds: string[] = []
): Promise<DocumentHit[]> {
  const readable = await scope(supabase)
  if (!readable.has(channel.id)) return []
  const rows = await searchDocumentRows(readable, q, {
    channelId: channel.id,
    limit: DOCUMENT_FETCH,
  })
  const lineage = await loadLineageInfo(readable, [...rows.map(d => d.id), ...excludeIds])
  const skip = new Set(excludeIds)
  // 파일명 결과에 이미 있는 문서(같은 계보 포함)는 뺀다
  const skipRoots = new Set(excludeIds.map(id => lineage.get(id)?.root ?? id))
  const picked = collapseByLineage(rows, lineage)
    .filter(d => !skip.has(d.id) && !skipRoots.has(lineage.get(d.id)?.root ?? d.id))
    .slice(0, DOCUMENT_LIMIT)
  // 버전 게시물·스레드 첨부는 답글이라 ?thread=<부모> 가 있어야 그 메시지로 간다
  const metas = await getSearchMessageMeta(
    picked.map(d => d.message_id),
    readable
  )
  return picked.map(d => toDocumentHit(d, channel, metas.get(d.message_id)?.parentId ?? null))
}

/** 필터 select 용: 내가 읽을 수 있는 채널(DM 제외)과 활성 구성원. */
export async function loadSearchFilters(supabase: WorkServerClient) {
  const [channels, people] = await Promise.all([
    scope(supabase).then(listSearchFilterChannels),
    listStaffDirectory(supabase),
  ])
  return {
    channels: channels.map(c => ({ id: c.id, name: c.name, slug: c.slug, kind: c.kind })),
    people: people
      .filter(p => p.status === 'active')
      .map(p => ({ user_id: p.user_id, display_name: p.display_name })),
  }
}
