/**
 * 예술지원사업 주간 회차 쿼리.
 *
 * 이 모듈은 **권한을 모른다** — `NextResponse`·`next/headers`·인가 모듈을 임포트하지
 * 않는다. 인가는 전부 라우트가 판정한다.
 *
 * 반환 형태는 snake_case다. `strict: false`라 키가 바뀌어도 타입 검사가 못 잡고
 * 화면이 조용히 빈다 — Drizzle 행 → snake_case 매핑을 손으로 쓴다.
 */
import { desc, eq } from 'drizzle-orm'

import { db } from '../client.ts'
import { grantDigests } from '../schema/content.ts'
import { toIso } from './_helpers.ts'

/** kosmart가 넘겨준 공고 한 건 + 관리자 편집 흔적. */
export interface GrantItem {
  /** `${source}:${source_id}` — 회차 간 중복 제거 키. */
  key: string
  source: string
  source_id: string
  title: string
  genres: string[]
  regions: string[]
  category: string
  apply_start: string | null
  /** YYYY-MM-DD 또는 null(상시). */
  apply_end: string | null
  url: string
  summary: string | null
  biz_type: string | null
  target: string | null
  /** 관리자가 이번 회차에서 뺀 항목. 발행 시 제외되지만 기록은 남는다. */
  excluded?: boolean
  /** 관리자가 손으로 넣은 항목(kosmart에 없는 공고). */
  manual?: boolean
}

export type GrantDigestStatus = 'draft' | 'published' | 'discarded'

export interface GrantDigestRow {
  id: string
  week_key: string
  items: GrantItem[]
  status: GrantDigestStatus
  post_id: string | null
  created_at: string
  published_at: string | null
}

function rowToDigest(row: typeof grantDigests.$inferSelect): GrantDigestRow {
  return {
    id: row.id,
    week_key: row.weekKey,
    items: (row.items ?? []) as GrantItem[],
    status: row.status as GrantDigestStatus,
    post_id: row.postId ?? null,
    created_at: toIso(row.createdAt),
    published_at: row.publishedAt ? toIso(row.publishedAt) : null,
  }
}

export interface CreateGrantDigestInput {
  week_key: string
  items: GrantItem[]
}

/**
 * 회차를 만든다. `week_key`에 유니크 인덱스가 있어 같은 주차를 두 번 만들면 던진다 —
 * 크론이 두 번 돌아도 회차가 둘로 갈리지 않는다.
 * @throws DB 쓰기가 실패하면 그대로 던진다(삼키지 않는다).
 */
export async function createGrantDigest(input: CreateGrantDigestInput): Promise<GrantDigestRow> {
  const [row] = await db
    .insert(grantDigests)
    .values({ weekKey: input.week_key, items: input.items })
    .returning()
  return rowToDigest(row)
}

/** @returns 행이 없으면 `null`. 조회 자체가 실패하면 throw한다. */
export async function getGrantDigestByWeekKey(weekKey: string): Promise<GrantDigestRow | null> {
  const rows = await db
    .select()
    .from(grantDigests)
    .where(eq(grantDigests.weekKey, weekKey))
    .limit(1)
  return rows[0] ? rowToDigest(rows[0]) : null
}

/** @returns 행이 없으면 `null`. */
export async function getGrantDigestById(id: string): Promise<GrantDigestRow | null> {
  const rows = await db.select().from(grantDigests).where(eq(grantDigests.id, id)).limit(1)
  return rows[0] ? rowToDigest(rows[0]) : null
}

/** 최신 회차부터. */
export async function listGrantDigests(limit: number): Promise<GrantDigestRow[]> {
  const rows = await db
    .select()
    .from(grantDigests)
    .orderBy(desc(grantDigests.createdAt))
    .limit(limit)
  return rows.map(rowToDigest)
}

/**
 * 최근 `weeks`개 회차의 항목을 평평하게 모은다. 중복 제거용이라 status를 가리지 않는다 —
 * 초안만 만들어두고 발행하지 않은 회차의 공고도 다음 주에 또 올리면 관리자가 같은 것을
 * 두 번 검토하게 된다.
 */
export async function listRecentDigestItems(weeks: number): Promise<GrantItem[]> {
  const rows = await db
    .select({ items: grantDigests.items })
    .from(grantDigests)
    .orderBy(desc(grantDigests.createdAt))
    .limit(weeks)
  return rows.flatMap(r => (r.items ?? []) as GrantItem[])
}

export type GrantDigestPatch = Partial<{
  items: GrantItem[]
  status: GrantDigestStatus
  post_id: string | null
  /** ISO 문자열. */
  published_at: string | null
}>

/**
 * 회차 일부를 갱신한다. patch가 비면 쿼리를 실행하지 않고 현재 행을 돌려준다.
 * @returns 행이 없으면 `null`.
 */
export async function updateGrantDigest(
  id: string,
  patch: GrantDigestPatch
): Promise<GrantDigestRow | null> {
  const values: Partial<typeof grantDigests.$inferInsert> = {}
  if (patch.items !== undefined) values.items = patch.items
  if (patch.status !== undefined) values.status = patch.status
  if (patch.post_id !== undefined) values.postId = patch.post_id
  if (patch.published_at !== undefined) {
    values.publishedAt = patch.published_at ? new Date(patch.published_at) : null
  }

  if (Object.keys(values).length === 0) {
    return getGrantDigestById(id)
  }

  const [row] = await db.update(grantDigests).set(values).where(eq(grantDigests.id, id)).returning()
  return row ? rowToDigest(row) : null
}
