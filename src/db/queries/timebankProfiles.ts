/**
 * 타임뱅크 프로필·이용규칙 동의·재가입 승계 (스펙 §3·§9.3·§9.4).
 *
 * 다른 `src/db/queries/*`와 같은 규칙 — **권한을 모른다.** 기능 스위치·조합원
 * 여부·본인 여부는 라우트가 판정한다. 여기서는 입력 모양(길이·분류)과 원장
 * 정합성(가입 크레딧·승계는 회원당 한 번)만 지킨다.
 *
 * - `agreeToTerms`는 동의 갱신과 가입 크레딧(또는 승계)을 **한 쓰기 트랜잭션**에서
 *   한다. 재동의는 아무것도 주지 않는다. 부분 유일 인덱스(`signup_grant_uq`·
 *   `carryover_uq`)와 `issueFromCoop`의 `ON CONFLICT DO NOTHING`이 두 번째 방어다.
 * - 재가입 키는 원문이 아니라 HMAC만 받는다(`src/lib/timebank/rejoinKey.ts`).
 *
 * 응답은 snake_case. 임포트는 상대경로 + `.ts`(`node --test`가 직접 import한다).
 */

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'

import { db } from '../client.ts'
import {
  memberProfiles,
  timebankProfiles,
  timebankTransfers,
  timebankWithdrawnKeys,
} from '../schema/index.ts'
import {
  TIMEBANK_CATEGORIES,
  TIMEBANK_PROFILE_TEXT_MAX,
  type TimebankCategory,
} from '../../constants/timebank.ts'
import type { TimebankSettings } from '../../lib/timebank/settings.ts'

import { toIso } from './_helpers.ts'
import { withWriteRetry } from './_writeRetry.ts'
import {
  issueFromCoop,
  TransferRejectedError,
  TransferStateError,
  type Tx,
} from './timebankLedger.ts'

// ── 타입·오류 ────────────────────────────────────────────────────────────────

export interface TimebankProfileRow {
  member_id: string
  offers: string
  needs: string
  categories: TimebankCategory[]
  visible: boolean
  terms_version: string | null
  agreed_at: string | null
  created_at: string | null
  updated_at: string | null
}

export type TimebankProfileField = 'offers' | 'needs' | 'categories' | 'visible'

/** 프로필 입력이 틀렸다. 라우트가 400으로 바꾼다. */
export class TimebankProfileInputError extends Error {
  readonly field: TimebankProfileField
  constructor(field: TimebankProfileField) {
    super(`timebank profile input invalid: ${field}`)
    this.name = 'TimebankProfileInputError'
    this.field = field
  }
}

export type TimebankProfileFields = {
  offers?: string
  needs?: string
  categories?: TimebankCategory[]
  visible?: boolean
}

type RawProfile = typeof timebankProfiles.$inferSelect

function toProfileRow(r: RawProfile): TimebankProfileRow {
  return {
    member_id: r.memberId,
    offers: r.offers ?? '',
    needs: r.needs ?? '',
    categories: Array.isArray(r.categories) ? r.categories : [],
    visible: r.visible === true,
    terms_version: r.termsVersion ?? null,
    agreed_at: toIso(r.agreedAt),
    created_at: toIso(r.createdAt),
    updated_at: toIso(r.updatedAt),
  }
}

function isFatal(e: unknown): boolean {
  return (
    e instanceof TransferRejectedError ||
    e instanceof TransferStateError ||
    e instanceof TimebankProfileInputError
  )
}

function write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWriteRetry(() => db.transaction(fn), { isFatal })
}

/** 조합원으로 참여할 수 있는 회원(판정 1의 회원 쪽 — `timebankLedger.loadMember`와 같은 조건). */
const memberEligible = () =>
  and(
    eq(memberProfiles.registrationStatus, 'approved'),
    eq(memberProfiles.isActive, true),
    eq(memberProfiles.isSuspended, false),
    isNull(memberProfiles.withdrawalRequestedAt)
  )

// ── 입력 검사 ────────────────────────────────────────────────────────────────

function text(value: unknown, field: 'offers' | 'needs'): string {
  if (typeof value !== 'string') throw new TimebankProfileInputError(field)
  const v = value.trim()
  if (v.length > TIMEBANK_PROFILE_TEXT_MAX) throw new TimebankProfileInputError(field)
  return v
}

function categories(value: unknown): TimebankCategory[] {
  if (!Array.isArray(value)) throw new TimebankProfileInputError('categories')
  const allowed = TIMEBANK_CATEGORIES as readonly string[]
  const out: TimebankCategory[] = []
  for (const c of value) {
    if (typeof c !== 'string' || !allowed.includes(c)) {
      throw new TimebankProfileInputError('categories')
    }
    if (!out.includes(c as TimebankCategory)) out.push(c as TimebankCategory)
  }
  return out
}

/** 준 칸만 검사해 Drizzle 값으로 돌려준다. 하나라도 틀리면 던진다(아무것도 쓰지 않는다). */
function parseFields(fields: TimebankProfileFields): Partial<RawProfile> {
  const out: Partial<RawProfile> = {}
  if (fields.offers !== undefined) out.offers = text(fields.offers, 'offers')
  if (fields.needs !== undefined) out.needs = text(fields.needs, 'needs')
  if (fields.categories !== undefined) out.categories = categories(fields.categories)
  if (fields.visible !== undefined) {
    if (typeof fields.visible !== 'boolean') throw new TimebankProfileInputError('visible')
    out.visible = fields.visible
  }
  return out
}

// ── 프로필 ───────────────────────────────────────────────────────────────────

export async function getTimebankProfile(memberId: string): Promise<TimebankProfileRow | null> {
  const [row] = await db
    .select()
    .from(timebankProfiles)
    .where(eq(timebankProfiles.memberId, memberId))
    .limit(1)
  return row ? toProfileRow(row) : null
}

/**
 * 프로필 칸을 만들거나 고친다. 준 칸만 바꾼다. 새 행은 `visible = false`, 동의
 * 없음(`terms_version`·`agreed_at` null)으로 시작한다 — 동의는 `agreeToTerms`만 한다.
 */
export async function upsertTimebankProfile(
  memberId: string,
  fields: TimebankProfileFields
): Promise<TimebankProfileRow> {
  const values = parseFields(fields ?? {})
  const now = new Date()
  const [row] = await db
    .insert(timebankProfiles)
    .values({ visible: false, ...values, memberId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: timebankProfiles.memberId,
      set: { ...values, updatedAt: now },
    })
    .returning()
  return toProfileRow(row)
}

// ── 동의 ─────────────────────────────────────────────────────────────────────

export type AgreeGrant = 'signup_grant' | 'carryover' | 'none'

/**
 * 이용규칙 동의(스펙 §9.3·§9.4). 한 쓰기 트랜잭션에서:
 *
 * 1. 프로필 upsert(`terms_version`, `agreed_at`). 같은 판 재동의는 `agreed_at`을 바꾸지 않는다.
 * 2. 처음 동의하는 것이고 가입 크레딧·승계를 받은 적이 없을 때만:
 *    - 재가입 키 중 하나라도 `timebank_withdrawn_keys`에 있으면 가장 최근 탈퇴의
 *      잔액을 본다. 음수면 `carryover`(회원 → coop, `|잔액|`), 0 이상이면 아무것도 없다.
 *    - 없으면 `signup_grant`(설정값, 0이면 없음).
 * 3. 재동의(이미 `agreed_at` 있음)는 2를 건너뛴다.
 */
export async function agreeToTerms(input: {
  memberId: string
  termsVersion: string
  rejoinKeys: string[]
  settings: TimebankSettings
  now?: Date
}): Promise<{ profile: TimebankProfileRow; granted: AgreeGrant }> {
  const termsVersion = typeof input.termsVersion === 'string' ? input.termsVersion.trim() : ''
  if (!termsVersion) throw new Error('agreeToTerms: termsVersion is required')
  const rejoinKeys = [...new Set((input.rejoinKeys ?? []).filter(k => typeof k === 'string' && k))]

  return write(async tx => {
    const now = input.now ?? new Date()
    const [existing] = await tx
      .select()
      .from(timebankProfiles)
      .where(eq(timebankProfiles.memberId, input.memberId))
      .limit(1)
    const firstAgreement = existing?.agreedAt == null

    let profile: RawProfile
    if (!existing) {
      ;[profile] = await tx
        .insert(timebankProfiles)
        .values({
          memberId: input.memberId,
          visible: false,
          termsVersion,
          agreedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    } else {
      const sameVersion = existing.termsVersion === termsVersion && existing.agreedAt != null
      ;[profile] = await tx
        .update(timebankProfiles)
        .set({
          termsVersion,
          agreedAt: sameVersion ? existing.agreedAt : now,
          updatedAt: now,
        })
        .where(eq(timebankProfiles.memberId, input.memberId))
        .returning()
    }

    if (!firstAgreement) return { profile: toProfileRow(profile), granted: 'none' as const }

    // 프로필 행이 지워졌다 다시 생긴 경우(관리 실수 등)에도 다시 주지 않는다.
    const [prior] = await tx
      .select({ id: timebankTransfers.id })
      .from(timebankTransfers)
      .where(
        or(
          and(
            eq(timebankTransfers.kind, 'signup_grant'),
            eq(timebankTransfers.toAccount, input.memberId)
          ),
          and(
            eq(timebankTransfers.kind, 'carryover'),
            eq(timebankTransfers.fromAccount, input.memberId)
          )
        )
      )
      .limit(1)
    if (prior) return { profile: toProfileRow(profile), granted: 'none' as const }

    if (rejoinKeys.length > 0) {
      const [match] = await tx
        .select({ balance: timebankWithdrawnKeys.balanceMinutes })
        .from(timebankWithdrawnKeys)
        .where(inArray(timebankWithdrawnKeys.keyHash, rejoinKeys))
        .orderBy(desc(timebankWithdrawnKeys.withdrawnAt))
        .limit(1)
      if (match) {
        const balance = Number(match.balance)
        if (!(balance < 0)) return { profile: toProfileRow(profile), granted: 'none' as const }
        await issueFromCoop(
          {
            kind: 'carryover',
            memberId: input.memberId,
            minutes: -balance,
            actorId: null,
            memo: 'rejoin_carryover',
            now,
          },
          tx
        )
        return { profile: toProfileRow(profile), granted: 'carryover' as const }
      }
    }

    const grant = input.settings.signup_grant_minutes
    if (!(Number.isSafeInteger(grant) && grant > 0)) {
      return { profile: toProfileRow(profile), granted: 'none' as const }
    }
    await issueFromCoop(
      { kind: 'signup_grant', memberId: input.memberId, minutes: grant, actorId: null, now },
      tx
    )
    return { profile: toProfileRow(profile), granted: 'signup_grant' as const }
  })
}

// ── 목록 ─────────────────────────────────────────────────────────────────────

/**
 * 기록 상대로 고를 수 있는 사람: 현재 판에 동의했고 참여 자격(승인·활성·정지 아님·
 * 탈퇴 신청 없음)이 있는 회원. 식별을 줄이려고 (id, 표시명)만 담는다(스펙 §15 M).
 */
export async function listParticipants(
  termsVersion: string
): Promise<Array<{ id: string; display_name: string }>> {
  const rows = await db
    .select({ id: memberProfiles.id, displayName: memberProfiles.displayName })
    .from(timebankProfiles)
    .innerJoin(memberProfiles, eq(memberProfiles.id, timebankProfiles.memberId))
    .where(
      and(
        eq(timebankProfiles.termsVersion, termsVersion),
        isNotNull(timebankProfiles.agreedAt),
        memberEligible()
      )
    )
    .orderBy(memberProfiles.displayName, memberProfiles.id)
  return rows.map(r => ({ id: r.id, display_name: r.displayName }))
}

/** 재능 디렉터리: `visible = true`이고 참여 자격이 있는 회원의 공개 칸만. */
export async function listDirectory(): Promise<
  Array<{
    id: string
    display_name: string
    offers: string
    needs: string
    categories: TimebankCategory[]
  }>
> {
  const rows = await db
    .select({
      id: memberProfiles.id,
      displayName: memberProfiles.displayName,
      offers: timebankProfiles.offers,
      needs: timebankProfiles.needs,
      categories: timebankProfiles.categories,
    })
    .from(timebankProfiles)
    .innerJoin(memberProfiles, eq(memberProfiles.id, timebankProfiles.memberId))
    .where(
      and(
        eq(timebankProfiles.visible, true),
        isNotNull(timebankProfiles.agreedAt),
        memberEligible()
      )
    )
    .orderBy(desc(timebankProfiles.updatedAt), memberProfiles.id)
  return rows.map(r => ({
    id: r.id,
    display_name: r.displayName,
    offers: r.offers ?? '',
    needs: r.needs ?? '',
    categories: Array.isArray(r.categories) ? r.categories : [],
  }))
}

// ── 탈퇴 키 ──────────────────────────────────────────────────────────────────

/**
 * 재가입 키(`rejoinKeysFor`)의 재료 — 그 회원의 현재 이메일·전화만 좁혀 읽는다.
 * `getProfileById`는 계좌·실명 등 33칸을 전부 싣는다(`getProfileAuthzFields`와 같은
 * 이유로 쓰지 않는다). 동의 라우트가 **세션 회원 본인 것만** 서버에서 읽는다.
 */
export async function getRejoinIdentity(
  memberId: string
): Promise<{ email: string | null; phone: string | null } | null> {
  const [row] = await db
    .select({ email: memberProfiles.email, phone: memberProfiles.phoneNumber })
    .from(memberProfiles)
    .where(eq(memberProfiles.id, memberId))
    .limit(1)
  return row ? { email: row.email ?? null, phone: row.phone ?? null } : null
}

/**
 * 탈퇴 트랜잭션(Task 10 `withdrawMember`) 안에서 재가입 키를 남긴다. 같은 키가
 * 이미 있으면(재가입 후 재탈퇴) 최신 잔액·일자로 덮는다. 여러 행은 한 INSERT로.
 */
export async function recordWithdrawnKeys(
  tx: Tx,
  keys: string[],
  balanceMinutes: number,
  at: Date
): Promise<void> {
  const unique = [...new Set((keys ?? []).filter(k => typeof k === 'string' && k))]
  if (unique.length === 0) return
  if (!Number.isSafeInteger(balanceMinutes)) {
    throw new Error('recordWithdrawnKeys: balanceMinutes must be an integer')
  }
  await tx
    .insert(timebankWithdrawnKeys)
    .values(unique.map(keyHash => ({ keyHash, balanceMinutes, withdrawnAt: at })))
    .onConflictDoUpdate({
      target: timebankWithdrawnKeys.keyHash,
      set: {
        balanceMinutes: sql`excluded.balance_minutes`,
        withdrawnAt: sql`excluded.withdrawn_at`,
      },
    })
}
