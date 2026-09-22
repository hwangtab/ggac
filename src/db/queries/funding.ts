/**
 * 캠페인·리워드 쿼리 계층. 권한을 모르고, 검증된 값만 받고, 응답 키는 snake_case다.
 * 후원·재고·확정은 `fundingPledges.ts`에 있다.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import { db } from '../client.ts'
import { fundingCampaigns, fundingPledges, fundingRewards } from '../schema/index.ts'
import type { CampaignAction, CampaignStatus } from '../../lib/funding/transitions.ts'
import { nextStatus, PUBLIC_CAMPAIGN_STATUSES } from '../../lib/funding/transitions.ts'

import { toIso, toSnakeCase } from './_helpers.ts'

type Row = Record<string, unknown>

const CAMPAIGN_DATE_COLUMNS = [
  'startAt', 'endAt', 'submittedAt', 'approvedAt', 'closedAt', 'settledAt', 'termsAgreedAt', 'createdAt', 'updatedAt',
] as const

function rowToCampaign(row: Row): Row {
  const snake = toSnakeCase(row)
  for (const key of CAMPAIGN_DATE_COLUMNS) {
    snake[key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)] = toIso(row[key] as Date | null)
  }
  return snake
}

function rowToReward(row: Row): Row {
  const snake = toSnakeCase(row)
  snake.locked_at = toIso(row.lockedAt as Date | null)
  snake.created_at = toIso(row.createdAt as Date | null)
  snake.updated_at = toIso(row.updatedAt as Date | null)
  return snake
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------- 캠페인

export async function createCampaign(input: {
  owner_user_id: string
  title: string
  summary: string
  story?: string
  category?: string
  goal_amount: number
  start_at?: string | null
  end_at?: string | null
  cover_image?: string | null
  og_image?: string | null
  project_slug?: string | null
  terms_version?: string | null
}): Promise<Row> {
  const id = randomUUID()
  const [row] = await db
    .insert(fundingCampaigns)
    .values({
      id,
      // 승인 전 임시 slug. 승인 시 `transitionCampaign`이 정식 slug로 바꾼다.
      slug: `draft-${id.slice(0, 8)}`,
      ownerUserId: input.owner_user_id,
      title: input.title,
      summary: input.summary,
      story: input.story ?? '',
      category: (input.category as (typeof fundingCampaigns.$inferInsert)['category']) ?? '기타',
      goalAmount: input.goal_amount,
      startAt: toDateOrNull(input.start_at),
      endAt: toDateOrNull(input.end_at),
      coverImage: input.cover_image ?? null,
      ogImage: input.og_image ?? null,
      projectSlug: input.project_slug ?? null,
      termsVersion: input.terms_version ?? null,
      termsAgreedAt: input.terms_version ? new Date() : null,
    })
    .returning()
  return rowToCampaign(row as Row)
}

export async function getCampaignById(id: string): Promise<Row | null> {
  const rows = await db.select().from(fundingCampaigns).where(eq(fundingCampaigns.id, id)).limit(1)
  return rows[0] ? rowToCampaign(rows[0] as Row) : null
}

export async function getCampaignBySlug(slug: string): Promise<Row | null> {
  const rows = await db.select().from(fundingCampaigns).where(eq(fundingCampaigns.slug, slug)).limit(1)
  return rows[0] ? rowToCampaign(rows[0] as Row) : null
}

export async function listCampaignsByOwner(ownerUserId: string): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingCampaigns)
    .where(eq(fundingCampaigns.ownerUserId, ownerUserId))
    .orderBy(desc(fundingCampaigns.createdAt))
  return rows.map(r => rowToCampaign(r as Row))
}

export async function listCampaignsForAdmin(filter: { status?: string } = {}): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingCampaigns)
    .where(filter.status ? eq(fundingCampaigns.status, filter.status as CampaignStatus) : undefined)
    .orderBy(desc(fundingCampaigns.createdAt))
  return rows.map(r => rowToCampaign(r as Row))
}

export async function listPublicCampaigns(): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingCampaigns)
    .where(inArray(fundingCampaigns.status, [...PUBLIC_CAMPAIGN_STATUSES]))
    .orderBy(desc(fundingCampaigns.approvedAt))
  return rows.map(r => rowToCampaign(r as Row))
}

/** 라우트가 편집 범위를 판정한 뒤 넘기는 snake_case 패치. 이 목록 밖 키는 버린다. */
const EDITABLE_CAMPAIGN_KEYS = [
  'title', 'summary', 'story', 'category', 'goal_amount', 'start_at', 'end_at', 'cover_image', 'og_image', 'project_slug',
] as const

export async function updateCampaignFields(id: string, patch: Record<string, unknown>): Promise<Row | null> {
  const set: Partial<typeof fundingCampaigns.$inferInsert> = {}
  for (const key of EDITABLE_CAMPAIGN_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    switch (key) {
      case 'start_at': set.startAt = toDateOrNull(value); break
      case 'end_at': set.endAt = toDateOrNull(value); break
      case 'goal_amount': set.goalAmount = Number(value); break
      case 'cover_image': set.coverImage = (value as string | null) ?? null; break
      case 'og_image': set.ogImage = (value as string | null) ?? null; break
      case 'project_slug': set.projectSlug = (value as string | null) ?? null; break
      case 'category': set.category = value as (typeof fundingCampaigns.$inferInsert)['category']; break
      default: (set as Record<string, unknown>)[key] = value
    }
  }
  if (Object.keys(set).length > 0) {
    await db.update(fundingCampaigns).set(set).where(eq(fundingCampaigns.id, id))
  }
  return getCampaignById(id)
}

/**
 * 상태 전이. `WHERE status = expectedFrom`으로 잠가 이중 마감·이중 승인을 막는다.
 * 전이표에 없는 조합이면 DB를 건드리지 않고 null.
 */
/**
 * `error`가 `funding_campaigns.slug` UNIQUE 위반인지 판별한다.
 *
 * 관리자 라우트가 주소 중복을 미리 확인하지만, 확인과 쓰기 사이에 다른
 * 관리자가 같은 주소로 먼저 승인하면 이 제약에 걸린다. `src/db/queries/board.ts`의
 * `isDuplicateMinutesError`와 같은 방식(메시지 기반, 컬럼명까지 확인).
 */
export function isDuplicateCampaignSlugError(error: unknown): boolean {
  const err = error as { message?: string; cause?: { message?: string } }
  const combined = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return /UNIQUE constraint failed:\s*funding_campaigns\.slug/.test(combined)
}

export async function transitionCampaign(input: {
  id: string
  action: CampaignAction
  expectedFrom: CampaignStatus
  slug?: string
  reviewNote?: string | null
  platformFeeRate?: number
}): Promise<Row | null> {
  const to = nextStatus(input.expectedFrom, input.action)
  if (!to) return null
  const now = new Date()
  const set: Partial<typeof fundingCampaigns.$inferInsert> = { status: to }
  if (input.action === 'submit') set.submittedAt = now
  if (input.action === 'approve') {
    set.approvedAt = now
    set.reviewNote = null
    if (input.slug) set.slug = input.slug
    if (input.platformFeeRate !== undefined) set.platformFeeRate = input.platformFeeRate
  }
  if (input.action === 'reject') set.reviewNote = input.reviewNote ?? null
  if (input.action === 'close') set.closedAt = now
  if (input.action === 'settle') set.settledAt = now

  const [row] = await db
    .update(fundingCampaigns)
    .set(set)
    .where(and(eq(fundingCampaigns.id, input.id), eq(fundingCampaigns.status, input.expectedFrom)))
    .returning()
  return row ? rowToCampaign(row as Row) : null
}

export async function getCampaignProgress(
  campaignId: string
): Promise<{ raised_amount: number; backer_count: number }> {
  const [row] = await db
    .select({
      raised: sql<number>`COALESCE(SUM(${fundingPledges.totalAmount}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(fundingPledges)
    .where(and(eq(fundingPledges.campaignId, campaignId), eq(fundingPledges.status, 'paid')))
  return { raised_amount: Number(row?.raised ?? 0), backer_count: Number(row?.count ?? 0) }
}

// ---------------------------------------------------------------- 리워드

export async function listRewards(campaignId: string): Promise<Row[]> {
  const rows = await db
    .select()
    .from(fundingRewards)
    .where(eq(fundingRewards.campaignId, campaignId))
    .orderBy(asc(fundingRewards.sortOrder), asc(fundingRewards.createdAt))
  return rows.map(r => rowToReward(r as Row))
}

export async function getReward(id: string): Promise<Row | null> {
  const rows = await db.select().from(fundingRewards).where(eq(fundingRewards.id, id)).limit(1)
  return rows[0] ? rowToReward(rows[0] as Row) : null
}

export async function createReward(input: {
  campaign_id: string
  title: string
  description?: string | null
  amount: number
  total_quantity?: number | null
  requires_shipping?: boolean
  estimated_delivery?: string | null
  image_url?: string | null
  sort_order?: number
}): Promise<Row> {
  const [row] = await db
    .insert(fundingRewards)
    .values({
      campaignId: input.campaign_id,
      title: input.title,
      description: input.description ?? null,
      amount: input.amount,
      totalQuantity: input.total_quantity ?? null,
      requiresShipping: input.requires_shipping ?? false,
      estimatedDelivery: input.estimated_delivery ?? null,
      imageUrl: input.image_url ?? null,
      sortOrder: input.sort_order ?? 0,
    })
    .returning()
  return rowToReward(row as Row)
}

/**
 * `requireUnlocked`가 있으면 `WHERE locked_at IS NULL`을 같이 걸어 갱신한다.
 * 검증 시점(`evaluateRewardPatch`)과 이 쓰기 사이에 결제가 확정돼 리워드가
 * 잠기면(`fundingPledges.ts`의 `finalizePledgePayment`가 트랜잭션 안에서
 * 인라인으로 잠근다) 이 조건에 걸려 0행이 되고, 그 값을 호출자가
 * `changed: false`로 받는다 — 검증을 통과한 뒤에도 경합으로 잠길 수 있으므로
 * 마지막 방어선은 DB 조건이다.
 */
export async function updateReward(
  id: string,
  patch: {
    title?: string
    description?: string | null
    amount?: number
    total_quantity?: number | null
    requires_shipping?: boolean
    estimated_delivery?: string | null
    image_url?: string | null
    sort_order?: number
  },
  options: { requireUnlocked?: boolean } = {}
): Promise<{ changed: boolean; reward: Row | null }> {
  const set: Partial<typeof fundingRewards.$inferInsert> = {}
  if (patch.title !== undefined) set.title = patch.title
  if (patch.description !== undefined) set.description = patch.description
  if (patch.amount !== undefined) set.amount = patch.amount
  if (patch.total_quantity !== undefined) set.totalQuantity = patch.total_quantity
  if (patch.requires_shipping !== undefined) set.requiresShipping = patch.requires_shipping
  if (patch.estimated_delivery !== undefined) set.estimatedDelivery = patch.estimated_delivery
  if (patch.image_url !== undefined) set.imageUrl = patch.image_url
  if (patch.sort_order !== undefined) set.sortOrder = patch.sort_order
  if (Object.keys(set).length > 0) {
    const conditions = [eq(fundingRewards.id, id)]
    if (options.requireUnlocked) conditions.push(isNull(fundingRewards.lockedAt))
    const rows = await db
      .update(fundingRewards)
      .set(set)
      .where(and(...conditions))
      .returning({ id: fundingRewards.id })
    if (rows.length === 0 && options.requireUnlocked) {
      return { changed: false, reward: null }
    }
  }
  return { changed: true, reward: await getReward(id) }
}

export async function deleteReward(id: string): Promise<boolean> {
  const rows = await db.delete(fundingRewards).where(eq(fundingRewards.id, id)).returning({ id: fundingRewards.id })
  return rows.length > 0
}
