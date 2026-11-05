/**
 * 메일함 라벨 쿼리 계층 (Turso/Drizzle). 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다**. 누가 라벨을
 * 만들고 붙일 수 있는지는 라우트가 판정한다.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { inboundEmailLabels, inboundEmails, mailLabels } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export type MailLabel = {
  id: string
  name: string
  color: string
  /** 이 라벨이 붙은 메일 수. */
  email_count: number
  created_at: string | null
}

/** `lower(name)` 유일 인덱스 위반 — 대소문자만 다른 같은 이름. 인덱스 이름까지 본다(다른 제약 위반과 섞지 않게). */
export function isDuplicateLabelNameError(error: unknown): boolean {
  const err = error as { message?: string; cause?: { message?: string } }
  const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /UNIQUE constraint failed:\s*index 'mail_labels_name_idx'/.test(combined)
}

export async function listLabels(): Promise<MailLabel[]> {
  const rows = await db
    .select({
      id: mailLabels.id,
      name: mailLabels.name,
      color: mailLabels.color,
      createdAt: mailLabels.createdAt,
      emailCount: sql<number>`(select count(*) from inbound_email_labels l
        where l.label_id = "mail_labels"."id")`,
    })
    .from(mailLabels)
    .orderBy(asc(sql`lower(${mailLabels.name})`))
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    email_count: Number(row.emailCount ?? 0),
    created_at: toIso(row.createdAt),
  }))
}

export async function countLabels(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(mailLabels)
  return Number(row?.n ?? 0)
}

export async function labelExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mailLabels.id })
    .from(mailLabels)
    .where(eq(mailLabels.id, id))
    .limit(1)
  return Boolean(row)
}

/** 만든다. 같은 이름(대소문자 무시)이 있으면 `'duplicate'`. */
export async function createLabel(input: {
  name: string
  color: string
}): Promise<{ id: string; name: string; color: string } | 'duplicate'> {
  try {
    const [row] = await db
      .insert(mailLabels)
      .values({ name: input.name, color: input.color })
      .returning({ id: mailLabels.id, name: mailLabels.name, color: mailLabels.color })
    return row
  } catch (error) {
    if (isDuplicateLabelNameError(error)) return 'duplicate'
    throw error
  }
}

/** 이름·색 바꾸기. 없으면 `'missing'`, 같은 이름이 있으면 `'duplicate'`. */
export async function updateLabel(input: {
  id: string
  name?: string
  color?: string
}): Promise<'updated' | 'missing' | 'duplicate'> {
  try {
    const rows = await db
      .update(mailLabels)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      })
      .where(eq(mailLabels.id, input.id))
      .returning({ id: mailLabels.id })
    return rows.length > 0 ? 'updated' : 'missing'
  } catch (error) {
    if (isDuplicateLabelNameError(error)) return 'duplicate'
    throw error
  }
}

/** 지운다 — 메일에 붙은 연결도 함께 지워진다(FK cascade). 지웠으면 true. */
export async function deleteLabel(id: string): Promise<boolean> {
  const rows = await db
    .delete(mailLabels)
    .where(eq(mailLabels.id, id))
    .returning({ id: mailLabels.id })
  return rows.length > 0
}

/**
 * 여러 메일에 라벨 하나를 붙이거나 뗀다. 있는 메일에만 붙인다 — 없는 메일 id는 `missing`으로 돌려준다(FK 오류로
 * 전체를 실패시키지 않게 먼저 거른다). 이미 붙어 있으면 그대로 둔다(멱등).
 */
export async function setLabelOnEmails(input: {
  labelId: string
  emailIds: string[]
  action: 'add' | 'remove'
  by: string
}): Promise<{ changed: string[]; missing: string[] }> {
  const ids = [...new Set(input.emailIds)]
  if (ids.length === 0) return { changed: [], missing: [] }
  const existing = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(inArray(inboundEmails.id, ids))
  const found = new Set(existing.map(row => row.id))
  const present = ids.filter(id => found.has(id))
  const missing = ids.filter(id => !found.has(id))
  if (present.length === 0) return { changed: [], missing }

  if (input.action === 'add') {
    const rows = await db
      .insert(inboundEmailLabels)
      .values(present.map(emailId => ({ emailId, labelId: input.labelId, createdBy: input.by })))
      .onConflictDoNothing()
      .returning({ emailId: inboundEmailLabels.emailId })
    return { changed: rows.map(row => row.emailId), missing }
  }
  const rows = await db
    .delete(inboundEmailLabels)
    .where(
      and(
        eq(inboundEmailLabels.labelId, input.labelId),
        inArray(inboundEmailLabels.emailId, present)
      )
    )
    .returning({ emailId: inboundEmailLabels.emailId })
  return { changed: rows.map(row => row.emailId), missing }
}

export type EmailLabel = { id: string; name: string; color: string }

/** 메일 한 통의 라벨(이름순). */
export async function listLabelsForEmail(emailId: string): Promise<EmailLabel[]> {
  return db
    .select({ id: mailLabels.id, name: mailLabels.name, color: mailLabels.color })
    .from(inboundEmailLabels)
    .innerJoin(mailLabels, eq(mailLabels.id, inboundEmailLabels.labelId))
    .where(eq(inboundEmailLabels.emailId, emailId))
    .orderBy(asc(sql`lower(${mailLabels.name})`))
}
