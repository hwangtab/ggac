/**
 * 자동결제 카드(빌링키) 쿼리 계층.
 *
 * `profiles.ts`·`payments.ts`와 같은 규칙 — 권한을 모르고, 검증된 id만 받고,
 * 응답 키는 snake_case다.
 *
 * **빌링키는 이 계층 밖으로 함부로 나가면 안 된다.** 조회 함수가 빌링키를
 * 그대로 실어 주므로, 호출부(라우트)가 응답에 담지 않도록 주의해야 한다 —
 * 그건 `scripts/testing/payments-route-guards.test.mjs`가 고정한다.
 */

import { and, desc, eq } from 'drizzle-orm'

import { db } from '../client.ts'
import { billingKeys, memberProfiles } from '../schema/index.ts'

import { toIso, toSnakeCase } from './_helpers.ts'

export interface SaveBillingKeyInput {
  userId: string
  billingKey: string
  customerKey: string
  cardIssuerCode?: string | null
  cardNumberMasked?: string | null
  cardType?: string | null
}

function rowToCard(row: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnakeCase(row)
  snake.deactivated_at = toIso(row.deactivatedAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

/**
 * 카드를 등록한다. 기존 활성 카드가 있으면 **먼저 비활성으로 내린다.**
 *
 * 토스는 카드 교체 기능을 제공하지 않는다 — 카드가 바뀌면 빌링키를 새로
 * 발급받는 방식이다. 그래서 등록은 언제나 "이전 것을 내리고 새 것을 올리는"
 * 동작이어야 하고, 순서가 뒤바뀌면 부분 유니크 인덱스가 거부한다.
 */
export async function saveBillingKey(input: SaveBillingKeyInput): Promise<Record<string, unknown>> {
  await deactivateBillingKey(input.userId)

  const rows = await db
    .insert(billingKeys)
    .values({
      userId: input.userId,
      billingKey: input.billingKey,
      customerKey: input.customerKey,
      cardIssuerCode: input.cardIssuerCode ?? null,
      cardNumberMasked: input.cardNumberMasked ?? null,
      cardType: input.cardType ?? null,
      isActive: true,
    })
    .returning()
  return rowToCard(rows[0])
}

export async function getActiveBillingKey(userId: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(billingKeys)
    .where(and(eq(billingKeys.userId, userId), eq(billingKeys.isActive, true)))
    .limit(1)
  return rows[0] ? rowToCard(rows[0]) : null
}

/**
 * 해지. 행을 지우지 않고 비활성으로 내린다 — "언제 해지했는가"가 분쟁의
 * 근거가 된다.
 *
 * @returns 해지된 카드(빌링키 포함). 호출부는 이 값으로 토스에도 삭제를
 *   요청한다. 활성 카드가 없으면 `null`.
 */
export async function deactivateBillingKey(
  userId: string
): Promise<Record<string, unknown> | null> {
  const current = await getActiveBillingKey(userId)
  if (!current) return null

  await db
    .update(billingKeys)
    .set({ isActive: false, deactivatedAt: new Date() })
    .where(and(eq(billingKeys.userId, userId), eq(billingKeys.isActive, true)))

  return { ...current, is_active: false }
}

/** 해지 이력 포함 전체. 최신순. */
export async function listBillingKeyHistory(userId: string): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(billingKeys)
    .where(eq(billingKeys.userId, userId))
    .orderBy(desc(billingKeys.createdAt))
  return rows.map(rowToCard)
}

export async function countBillingKeys(userId: string): Promise<number> {
  const rows = await db
    .select({ id: billingKeys.id })
    .from(billingKeys)
    .where(eq(billingKeys.userId, userId))
  return rows.length
}

/**
 * 이번 달 청구를 걸 대상. 매월 청구 크론이 쓰는 유일한 조회다.
 *
 * **승인된 활성 조합원만** 고른다 — 정지·탈퇴한 회원의 카드가 남아 있어도
 * 청구하지 않는다. 그런 청구는 그대로 분쟁이 된다.
 *
 * 청구 금액(`monthly_fee`)을 함께 실어 온다. 크론이 회원마다 프로필을 다시
 * 조회하면 회원 수만큼 왕복이 늘어난다.
 */
export async function listActiveBillingTargets(): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select({
      user_id: billingKeys.userId,
      billing_key: billingKeys.billingKey,
      customer_key: billingKeys.customerKey,
      monthly_fee: memberProfiles.monthlyFee,
      display_name: memberProfiles.displayName,
      email: memberProfiles.email,
    })
    .from(billingKeys)
    .innerJoin(memberProfiles, eq(memberProfiles.id, billingKeys.userId))
    .where(
      and(
        eq(billingKeys.isActive, true),
        eq(memberProfiles.registrationStatus, 'approved'),
        eq(memberProfiles.isActive, true),
        eq(memberProfiles.isSuspended, false)
      )
    )
  return rows as unknown as Record<string, unknown>[]
}
