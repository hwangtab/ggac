import { z } from 'zod'

/**
 * 메모 탭(0024, docs/05 §4-5) 입력 스키마·타입(순수 — 'use server' 파일에서는 export 할 수 없어 여기 둔다).
 * 낙관적 잠금: 저장할 때 화면이 알고 있는 버전(expectedVersion)을 함께 보낸다.
 */

export const NOTE_BODY_MAX = 100_000

const uuid = z.string().uuid('잘못된 식별자입니다.')
const version = z.number().int().min(1).max(1_000_000)

export const saveNoteSchema = z.object({
  noteId: uuid,
  expectedVersion: version,
  body: z.string().max(NOTE_BODY_MAX, '메모는 10만 자까지 쓸 수 있습니다.'),
})

export const revertNoteSchema = z.object({
  noteId: uuid,
  expectedVersion: version,
  toVersion: version,
})

export const noteIdSchema = z.object({ noteId: uuid })
export const noteRevisionSchema = z.object({ noteId: uuid, version })

/** 화면이 다루는 메모 한 건 */
export type NoteData = {
  id: string
  title: string | null
  body: string
  version: number
  updatedAt: string
  /** 마지막으로 저장한 사람(탈퇴·삭제된 사람이면 null) */
  updatedByName: string | null
}

export type NoteRevisionMeta = {
  version: number
  editedAt: string
  editedByName: string | null
}

export type NoteRevision = NoteRevisionMeta & { title: string | null; body: string }

/** 저장·되돌리기 결과 — 그 사이 다른 사람이 저장했으면 conflict 와 최신 메모를 돌려준다 */
export type SaveNoteResult =
  | { status: 'saved'; note: NoteData }
  | { status: 'conflict'; latest: NoteData }
