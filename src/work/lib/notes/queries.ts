import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import {
  getNoteChannelId,
  getNoteRecord,
  getNoteRevisionRow,
  listNoteRevisionRows,
  type WorkNoteRecord,
} from '@/db/queries/work/notes'
import type { WorkServerClient } from '@work/lib/supabase/server'
import type { NoteData, NoteRevision, NoteRevisionMeta } from './schema'

/**
 * 메모 조회(서버 전용) — 원본 kosmart-work `lib/notes/queries.ts`와 같은 이름·결과 모양.
 * 원본은 RLS(conversation_notes_select·conversation_note_revisions_select = can_read_channel)가 걸렀다. 여기서는
 * 메모가 속한 대화를 읽을 수 있는지 **먼저 확인하고** 쿼리 계층을 부른다 — 못 읽으면 없는 것과 같다(null·빈 목록).
 */

/** 원본 PostgREST select 열(이식 뒤에는 쿼리 계층이 같은 열을 읽는다) */
export const NOTE_COLUMNS =
  'id, title, body, version, updated_at, staff!conversation_notes_updated_by_fkey(display_name)' as const

export function toNoteData(row: WorkNoteRecord): NoteData {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
  }
}

/** 이 메모를 읽을 수 있나(메모의 대화 → 읽기 범위). 메모가 없어도 false */
export async function canReadNote(supabase: WorkServerClient, noteId: string): Promise<boolean> {
  const channelId = await getNoteChannelId(noteId)
  if (!channelId) return false
  return (await readableChannelIds(viewerOf(supabase))).has(channelId)
}

/** 메모 한 건(이 대화 소속일 때만). 없거나 못 읽으면 null */
export async function getNote(
  supabase: WorkServerClient,
  noteId: string,
  channelId?: string
): Promise<NoteData | null> {
  if (!(await canReadNote(supabase, noteId))) return null
  const row = await getNoteRecord(noteId, channelId)
  return row ? toNoteData(row) : null
}

/** 저장 이력(최신 → 오래된). 메모당 최근 200개. 못 읽으면 빈 목록 */
export async function listRevisions(
  supabase: WorkServerClient,
  noteId: string
): Promise<NoteRevisionMeta[]> {
  if (!(await canReadNote(supabase, noteId))) return []
  return listNoteRevisionRows(noteId)
}

/** 이력 한 버전의 본문. 없거나 못 읽으면 null */
export async function getRevision(
  supabase: WorkServerClient,
  noteId: string,
  version: number
): Promise<NoteRevision | null> {
  if (!(await canReadNote(supabase, noteId))) return null
  return getNoteRevisionRow(noteId, version)
}
