/**
 * 메일함 내부 메모 쿼리 계층 (Turso/Drizzle).
 *
 * `mailbox.ts`와 **일부러 다른 파일**이다 — 발송 경로(답장·새 메일·전달 라우트)는 `mailbox.ts`를 들여오지만 이
 * 파일은 들여오지 않는다. 메모 본문이 나가는 메일에 섞일 길을 모듈 경계로 막는다. 상세 조회 라우트와 메모 라우트만
 * 이 파일을 쓴다.
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 쓰고 고치고 지울 수 있는지는 라우트가 판정하고,
 * 여기는 검증된 값만 받는다(고치기·지우기의 조건은 인자로 받아 WHERE에 넣는다).
 */

import { and, asc, eq } from 'drizzle-orm'

import { db } from '../client.ts'
import { inboundEmailNotes, memberProfiles } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export type MailboxNote = {
  id: string
  email_id: string
  author_id: string | null
  /** 쓴 사람의 표시 이름. 프로필이 지워졌으면 null(화면이 "탈퇴한 회원"으로 그린다). */
  author_name: string | null
  body: string
  created_at: string | null
  updated_at: string | null
}

const columns = {
  id: inboundEmailNotes.id,
  emailId: inboundEmailNotes.emailId,
  authorId: inboundEmailNotes.authorId,
  authorName: memberProfiles.displayName,
  body: inboundEmailNotes.body,
  createdAt: inboundEmailNotes.createdAt,
  updatedAt: inboundEmailNotes.updatedAt,
}

function toNote(row: {
  id: string
  emailId: string
  authorId: string | null
  authorName: string | null
  body: string
  createdAt: Date | null
  updatedAt: Date | null
}): MailboxNote {
  return {
    id: row.id,
    email_id: row.emailId,
    author_id: row.authorId,
    author_name: row.authorName ?? null,
    body: row.body,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  }
}

/** 이 메일의 메모. 오래된 것부터 — 대화처럼 읽힌다. */
export async function listNotesForEmail(emailId: string): Promise<MailboxNote[]> {
  const rows = await db
    .select(columns)
    .from(inboundEmailNotes)
    .leftJoin(memberProfiles, eq(memberProfiles.id, inboundEmailNotes.authorId))
    .where(eq(inboundEmailNotes.emailId, emailId))
    .orderBy(asc(inboundEmailNotes.createdAt), asc(inboundEmailNotes.id))
  return rows.map(toNote)
}

export async function getNote(id: string): Promise<MailboxNote | null> {
  const [row] = await db
    .select(columns)
    .from(inboundEmailNotes)
    .leftJoin(memberProfiles, eq(memberProfiles.id, inboundEmailNotes.authorId))
    .where(eq(inboundEmailNotes.id, id))
    .limit(1)
  return row ? toNote(row) : null
}

export async function insertNote(input: {
  email_id: string
  author_id: string
  body: string
}): Promise<MailboxNote> {
  const [row] = await db
    .insert(inboundEmailNotes)
    .values({ emailId: input.email_id, authorId: input.author_id, body: input.body })
    .returning({ id: inboundEmailNotes.id })
  return (await getNote(row.id)) as MailboxNote
}

/**
 * 메모 고치기 — **쓴 사람의 것만** 바뀐다(`author_id` 조건). 이 메일의 메모가 아니면 바뀌지 않는다(`email_id`
 * 조건 — 경로의 메일 id와 메모가 어긋나는 시도). 바뀐 행이 없으면 null.
 */
export async function updateOwnNote(input: {
  id: string
  email_id: string
  author_id: string
  body: string
}): Promise<MailboxNote | null> {
  const rows = await db
    .update(inboundEmailNotes)
    .set({ body: input.body })
    .where(
      and(
        eq(inboundEmailNotes.id, input.id),
        eq(inboundEmailNotes.emailId, input.email_id),
        eq(inboundEmailNotes.authorId, input.author_id)
      )
    )
    .returning({ id: inboundEmailNotes.id })
  return rows.length > 0 ? getNote(input.id) : null
}

/**
 * 메모 지우기. `author_id`를 주면 그 사람의 메모만, `null`이면(관리자) 누구 것이든 지운다 — 누가 그 자격인지는
 * 라우트가 정한다. 이 메일의 메모만 지운다. 지웠으면 true.
 */
export async function deleteNote(input: {
  id: string
  email_id: string
  author_id: string | null
}): Promise<boolean> {
  const conditions = [
    eq(inboundEmailNotes.id, input.id),
    eq(inboundEmailNotes.emailId, input.email_id),
  ]
  if (input.author_id !== null) conditions.push(eq(inboundEmailNotes.authorId, input.author_id))
  const rows = await db
    .delete(inboundEmailNotes)
    .where(and(...conditions))
    .returning({ id: inboundEmailNotes.id })
  return rows.length > 0
}
