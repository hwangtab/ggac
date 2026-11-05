/**
 * 메일함 답장 템플릿 쿼리 계층 (Turso/Drizzle). **권한을 모른다** — 관리자만 다루는지는 라우트가 판정한다.
 */

import { asc, eq, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { mailReplyTemplates } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export type ReplyTemplate = {
  id: string
  name: string
  body: string
  updated_at: string | null
}

/** `lower(name)` 유일 인덱스 위반(식 인덱스라 libsql이 인덱스 이름으로 알린다). */
export function isDuplicateTemplateNameError(error: unknown): boolean {
  const err = error as { message?: string; cause?: { message?: string } }
  const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /UNIQUE constraint failed:\s*index 'mail_reply_templates_name_idx'/.test(combined)
}

export async function listTemplates(): Promise<ReplyTemplate[]> {
  const rows = await db
    .select({
      id: mailReplyTemplates.id,
      name: mailReplyTemplates.name,
      body: mailReplyTemplates.body,
      updatedAt: mailReplyTemplates.updatedAt,
    })
    .from(mailReplyTemplates)
    .orderBy(asc(sql`lower(${mailReplyTemplates.name})`))
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    body: row.body,
    updated_at: toIso(row.updatedAt),
  }))
}

export async function countTemplates(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(mailReplyTemplates)
  return Number(row?.n ?? 0)
}

export async function createTemplate(input: {
  name: string
  body: string
  created_by: string
}): Promise<{ id: string } | 'duplicate'> {
  try {
    const [row] = await db
      .insert(mailReplyTemplates)
      .values({ name: input.name, body: input.body, createdBy: input.created_by })
      .returning({ id: mailReplyTemplates.id })
    return row
  } catch (error) {
    if (isDuplicateTemplateNameError(error)) return 'duplicate'
    throw error
  }
}

export async function updateTemplate(input: {
  id: string
  name?: string
  body?: string
}): Promise<'updated' | 'missing' | 'duplicate'> {
  try {
    const rows = await db
      .update(mailReplyTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      })
      .where(eq(mailReplyTemplates.id, input.id))
      .returning({ id: mailReplyTemplates.id })
    return rows.length > 0 ? 'updated' : 'missing'
  } catch (error) {
    if (isDuplicateTemplateNameError(error)) return 'duplicate'
    throw error
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const rows = await db
    .delete(mailReplyTemplates)
    .where(eq(mailReplyTemplates.id, id))
    .returning({ id: mailReplyTemplates.id })
  return rows.length > 0
}
