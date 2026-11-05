/**
 * 메일함 발신자 규칙 쿼리 계층 (Turso/Drizzle). **권한을 모른다** — 누가 규칙을 만들 수 있는지, 공용 도메인 확인을
 * 받았는지는 라우트가 판정한다. 맞추기는 정규화한 `from_email`과 완전 일치(주소) / `@` 뒤 완전 일치(도메인)다.
 */

import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import { inboundEmails, mailLabels, mailSenderRules } from '../schema/index.ts'

import { escapeLikePattern, LIKE_ESCAPE_CHAR, toIso } from './_helpers.ts'

export type SenderRule = {
  id: string
  match_type: 'address' | 'domain'
  match_value: string
  action: 'spam' | 'archive' | 'label'
  label_id: string | null
  label_name: string | null
  label_color: string | null
  created_at: string | null
}

/**
 * 규칙 중복 — 부분 유일 인덱스 둘 중 하나의 위반. 칼럼 인덱스라 libsql은 인덱스 이름이 아니라 칼럼 목록으로 알린다
 * (`UNIQUE constraint failed: mail_sender_rules.match_type, mail_sender_rules.match_value, mail_sender_rules.action`
 * — 라벨 규칙이면 뒤에 `label_id`가 붙는다). 그 목록까지 본다.
 */
export function isDuplicateRuleError(error: unknown): boolean {
  const err = error as { message?: string; cause?: { message?: string } }
  const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /UNIQUE constraint failed:\s*mail_sender_rules\.match_type, mail_sender_rules\.match_value, mail_sender_rules\.action/.test(
    combined
  )
}

export async function listRules(): Promise<SenderRule[]> {
  const rows = await db
    .select({
      id: mailSenderRules.id,
      matchType: mailSenderRules.matchType,
      matchValue: mailSenderRules.matchValue,
      action: mailSenderRules.action,
      labelId: mailSenderRules.labelId,
      labelName: mailLabels.name,
      labelColor: mailLabels.color,
      createdAt: mailSenderRules.createdAt,
    })
    .from(mailSenderRules)
    .leftJoin(mailLabels, eq(mailLabels.id, mailSenderRules.labelId))
    .orderBy(asc(mailSenderRules.matchValue), asc(mailSenderRules.action))
  return rows.map(row => ({
    id: row.id,
    match_type: row.matchType as SenderRule['match_type'],
    match_value: row.matchValue,
    action: row.action as SenderRule['action'],
    label_id: row.labelId,
    label_name: row.labelName ?? null,
    label_color: row.labelColor ?? null,
    created_at: toIso(row.createdAt),
  }))
}

export async function countRules(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(mailSenderRules)
  return Number(row?.n ?? 0)
}

export async function createRule(input: {
  match_type: 'address' | 'domain'
  match_value: string
  action: 'spam' | 'archive' | 'label'
  label_id: string | null
  created_by: string
}): Promise<{ id: string } | 'duplicate'> {
  try {
    const [row] = await db
      .insert(mailSenderRules)
      .values({
        matchType: input.match_type,
        matchValue: input.match_value,
        action: input.action,
        labelId: input.label_id,
        createdBy: input.created_by,
      })
      .returning({ id: mailSenderRules.id })
    return row
  } catch (error) {
    if (isDuplicateRuleError(error)) return 'duplicate'
    throw error
  }
}

export async function deleteRule(id: string): Promise<boolean> {
  const rows = await db
    .delete(mailSenderRules)
    .where(eq(mailSenderRules.id, id))
    .returning({ id: mailSenderRules.id })
  return rows.length > 0
}

/** 이 발신 주소에 맞는 규칙들. 주소가 비었으면(정규화 실패) 아무것도 맞지 않는다. */
export async function rulesForSender(
  fromEmail: string | null
): Promise<{ action: 'spam' | 'archive' | 'label'; label_id: string | null }[]> {
  const email = (fromEmail ?? '').trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (!email || at < 0 || at === email.length - 1) return []
  const domain = email.slice(at + 1)
  const rows = await db
    .select({ action: mailSenderRules.action, labelId: mailSenderRules.labelId })
    .from(mailSenderRules)
    .where(
      or(
        and(eq(mailSenderRules.matchType, 'address'), eq(mailSenderRules.matchValue, email)),
        and(eq(mailSenderRules.matchType, 'domain'), eq(mailSenderRules.matchValue, domain))
      )
    )
  return rows.map(row => ({
    action: row.action as 'spam' | 'archive' | 'label',
    label_id: row.labelId,
  }))
}

function senderCondition(matchType: 'address' | 'domain', matchValue: string) {
  return matchType === 'address'
    ? eq(inboundEmails.fromEmail, matchValue)
    : sql`${inboundEmails.fromEmail} LIKE ${'%@' + escapeLikePattern(matchValue)} ESCAPE ${LIKE_ESCAPE_CHAR}`
}

/** 이 조건에 맞는 기존 메일 수 — 규칙을 만들기 전에 화면이 "기존 메일 N통에도 적용"을 보여 준다. */
export async function countMatchingEmails(
  matchType: 'address' | 'domain',
  matchValue: string
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(inboundEmails)
    .where(senderCondition(matchType, matchValue))
  return Number(row?.n ?? 0)
}

/**
 * 기존 메일에도 적용한다(규칙을 만들 때 고른 경우). 상태 규칙은 **안 읽음·읽음인 메일만** 옮긴다 — 답장한 메일·이미
 * 보관·스팸인 메일은 사람이 정한 상태라 건드리지 않는다. 라벨 규칙은 맞는 메일 전부에 붙인다(이미 있으면 그대로).
 * 바뀐 메일 수를 돌려준다.
 */
export async function applyRuleToExisting(input: {
  match_type: 'address' | 'domain'
  match_value: string
  action: 'spam' | 'archive' | 'label'
  label_id: string | null
}): Promise<number> {
  const where = senderCondition(input.match_type, input.match_value)
  if (input.action === 'label') {
    if (!input.label_id) return 0
    const result = await db.run(
      sql`insert into inbound_email_labels (email_id, label_id, created_by)
          select id, ${input.label_id}, null from inbound_emails where ${where}
          on conflict do nothing`
    )
    return Number(result.rowsAffected ?? 0)
  }
  const rows = await db
    .update(inboundEmails)
    .set({ status: input.action === 'spam' ? 'spam' : 'archived' })
    .where(and(where, inArray(inboundEmails.status, ['unread', 'read'])))
    .returning({ id: inboundEmails.id })
  return rows.length
}
