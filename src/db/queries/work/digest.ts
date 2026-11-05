/**
 * 멘션·DM 메일 다이제스트 쿼리 계층 — 원본 kosmart-work RPC `digest_candidates`(0027·0047)와 `work.digest_state`를 옮겼다
 * (설계 §8-5).
 *
 * **권한을 모른다.** 원본 SQL의 "활성 staff"(`staff.status='active'`) 자리는 여기서 거르지 않고 **판정 원자료**
 * (member_profiles 권한 열·멤버십 역할)를 행에 실어 돌려준다 — 이사회 권한·읽기 범위·방해 금지·digest_mode 지연은
 * 순수 함수 `src/work/lib/digest/select.ts`가 정한다. 대신 원본 SQL의 데이터 조건(안 읽음·지워지지 않음·본인 글 아님·
 * 알림 수준·마지막 읽은 시각·마지막 발송 이후)은 여기서 그대로 건다.
 */
import { and, eq, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workDigestState } from '../../schema/index.ts'

export type DigestCandidateRow = {
  recipient_id: string
  /** 'mention' | 'dm' */
  kind: 'mention' | 'dm'
  message_id: string
  parent_id: string | null
  message_kind: string
  channel_id: string
  channel_name: string
  channel_slug: string | null
  channel_kind: string
  author_name: string | null
  body: string
  sensitive: boolean
  created_at: Date
  /** 받는 사람 판정 원자료 */
  recipient_email: string | null
  recipient_member_role: 'owner' | 'member' | null
  recipient_digest_mode: string
  recipient_quiet: { enabled: boolean; start: number; end: number; weekends: boolean } | null
  recipient_profile: {
    registration_status: string | null
    is_active: boolean
    is_admin: boolean
    is_director: boolean
    is_auditor: boolean
  }
}

type RawRow = {
  recipient_id: string
  kind: string
  message_id: string
  parent_id: string | null
  message_kind: string
  channel_id: string
  channel_name: string
  channel_slug: string | null
  channel_kind: string
  author_name: string | null
  body: string
  sensitive: number
  created_at: number
  recipient_email: string | null
  member_role: string | null
  digest_mode: string | null
  quiet_enabled: number | null
  quiet_start: number | null
  quiet_end: number | null
  quiet_weekends: number | null
  registration_status: string | null
  is_active: number
  is_admin: number
  is_director: number
  is_auditor: number
}

/**
 * 원본 digest_candidates(0047) — 두 갈래:
 *   mention  멘션 행이 안 읽음(read_at null) · 알림 수준 '끔' 아님
 *   dm       DM·그룹의 새 글 · 알림 수준이 'all'(기본) · 이 사람이 멘션된 글은 제외(멘션 갈래가 맡는다)
 * 공통: 지워지지 않음 · 본인 글 아님 · 그 채널 last_read_at 이후 · `cutoff` 이전 · 마지막 발송(없으면 `defaultSince`) 이후 ·
 *       digest_mode가 'off'가 아님(행이 없으면 'off' — 0047 기본 끔).
 * digest_mode 'hourly'의 추가 지연(50분)·이사회 권한·방해 금지는 `select.ts`가 본다.
 * 정렬: 받는 사람 → 작성 시각 → 메시지 id(원본 `order by 1, 11, 3`).
 */
export async function listDigestCandidates(input: {
  cutoff: Date
  defaultSince: Date
}): Promise<DigestCandidateRow[]> {
  const cutoff = input.cutoff.getTime()
  const since = input.defaultSince.getTime()
  const rows = await db.all<RawRow>(sql`
    select * from (
      select mn.user_id as recipient_id, 'mention' as kind, m.id as message_id, m.parent_id as parent_id,
             m.kind as message_kind, c.id as channel_id, c.name as channel_name, c.slug as channel_slug,
             c.kind as channel_kind, a.display_name as author_name, m.body as body, m.sensitive as sensitive,
             m.created_at as created_at, rp.email as recipient_email, cm.role as member_role,
             sp.digest_mode as digest_mode, sp.quiet_enabled as quiet_enabled, sp.quiet_start as quiet_start,
             sp.quiet_end as quiet_end, sp.quiet_weekends as quiet_weekends,
             rp.registration_status as registration_status, rp.is_active as is_active, rp.is_admin as is_admin,
             rp.is_director as is_director, rp.is_auditor as is_auditor
      from work_mentions mn
      join work_messages m on m.id = mn.message_id
      join work_channels c on c.id = m.channel_id
      join work_channel_members cm on cm.channel_id = m.channel_id and cm.user_id = mn.user_id
      join member_profiles rp on rp.id = mn.user_id
      left join work_member_prefs sp on sp.user_id = mn.user_id
      left join member_profiles a on a.id = m.author_id
      left join work_digest_state ds on ds.user_id = mn.user_id
      where mn.read_at is null
        and m.deleted_at is null
        and (m.author_id is null or m.author_id <> mn.user_id)
        and coalesce(cm.notify_level, 'mentions') <> 'off'
        and coalesce(sp.digest_mode, 'off') <> 'off'
        and m.created_at > cm.last_read_at
        and m.created_at <= ${cutoff}
        and m.created_at > coalesce(ds.last_sent_at, ${since})
      union all
      select cm.user_id as recipient_id, 'dm' as kind, m.id as message_id, m.parent_id as parent_id,
             m.kind as message_kind, c.id as channel_id, c.name as channel_name, c.slug as channel_slug,
             c.kind as channel_kind, a.display_name as author_name, m.body as body, m.sensitive as sensitive,
             m.created_at as created_at, rp.email as recipient_email, cm.role as member_role,
             sp.digest_mode as digest_mode, sp.quiet_enabled as quiet_enabled, sp.quiet_start as quiet_start,
             sp.quiet_end as quiet_end, sp.quiet_weekends as quiet_weekends,
             rp.registration_status as registration_status, rp.is_active as is_active, rp.is_admin as is_admin,
             rp.is_director as is_director, rp.is_auditor as is_auditor
      from work_channels c
      join work_channel_members cm on cm.channel_id = c.id
      join work_messages m on m.channel_id = c.id
      join member_profiles rp on rp.id = cm.user_id
      left join work_member_prefs sp on sp.user_id = cm.user_id
      left join member_profiles a on a.id = m.author_id
      left join work_digest_state ds on ds.user_id = cm.user_id
      where c.kind = 'dm'
        and m.deleted_at is null
        and (m.author_id is null or m.author_id <> cm.user_id)
        and coalesce(cm.notify_level, 'all') = 'all'
        and coalesce(sp.digest_mode, 'off') <> 'off'
        and m.created_at > cm.last_read_at
        and m.created_at <= ${cutoff}
        and m.created_at > coalesce(ds.last_sent_at, ${since})
        and not exists (
          select 1 from work_mentions mm where mm.message_id = m.id and mm.user_id = cm.user_id)
    )
    order by recipient_id, created_at, message_id
  `)
  return rows.map(r => ({
    recipient_id: r.recipient_id,
    kind: r.kind === 'dm' ? 'dm' : 'mention',
    message_id: r.message_id,
    parent_id: r.parent_id,
    message_kind: r.message_kind,
    channel_id: r.channel_id,
    channel_name: r.channel_name,
    channel_slug: r.channel_slug,
    channel_kind: r.channel_kind,
    author_name: r.author_name,
    body: r.body,
    sensitive: Boolean(r.sensitive),
    created_at: new Date(Number(r.created_at)),
    recipient_email: r.recipient_email,
    recipient_member_role:
      r.member_role === 'owner' ? 'owner' : r.member_role === 'member' ? 'member' : null,
    recipient_digest_mode: r.digest_mode ?? 'off',
    recipient_quiet:
      r.quiet_enabled === null
        ? null
        : {
            enabled: Boolean(r.quiet_enabled),
            start: Number(r.quiet_start),
            end: Number(r.quiet_end),
            weekends: Boolean(r.quiet_weekends),
          },
    recipient_profile: {
      registration_status: r.registration_status,
      is_active: Boolean(r.is_active),
      is_admin: Boolean(r.is_admin),
      is_director: Boolean(r.is_director),
      is_auditor: Boolean(r.is_auditor),
    },
  }))
}

/** 마지막 발송 기준 올리기(원본 digest_state upsert) */
export async function upsertDigestState(userId: string, lastSentAt: Date): Promise<void> {
  await db
    .insert(workDigestState)
    .values({ userId, lastSentAt })
    .onConflictDoUpdate({ target: workDigestState.userId, set: { lastSentAt } })
}

/**
 * 이 사람의 다음 묶음 발송을 **차지한다** — 발송 기준(`last_sent_at`)이 아직 `prev` 일 때만 `next` 로 올린다(비교 후 교체).
 * 차지하면 true. 다이제스트 크론이 겹치거나 두 번 호출되면 두 실행이 같은 후보를 읽고 둘 다 보냈다(발송 뒤에야 기준을 올렸다 —
 * 2026-11-05 점검). 이제 메일을 보내기 **전에** 차지하고, 진 쪽은 보내지 않는다. 보내지 못하면 `releaseDigestSend`로 되돌린다.
 */
export async function claimDigestSend(
  userId: string,
  prev: Date | null,
  next: Date
): Promise<boolean> {
  if (prev === null) {
    const rows = await db
      .insert(workDigestState)
      .values({ userId, lastSentAt: next })
      .onConflictDoNothing()
      .returning({ userId: workDigestState.userId })
    return rows.length === 1
  }
  const rows = await db
    .update(workDigestState)
    .set({ lastSentAt: next })
    .where(and(eq(workDigestState.userId, userId), eq(workDigestState.lastSentAt, prev)))
    .returning({ userId: workDigestState.userId })
  return rows.length === 1
}

/** 차지한 발송을 되돌린다(보내지 못했을 때) — 그 사이 다른 실행이 더 올렸으면 건드리지 않는다 */
export async function releaseDigestSend(
  userId: string,
  prev: Date | null,
  next: Date
): Promise<void> {
  const mine = and(eq(workDigestState.userId, userId), eq(workDigestState.lastSentAt, next))
  if (prev === null) {
    await db.delete(workDigestState).where(mine)
    return
  }
  await db.update(workDigestState).set({ lastSentAt: prev }).where(mine)
}

export async function getDigestState(userId: string): Promise<Date | null> {
  const [r] = await db
    .select({ lastSentAt: workDigestState.lastSentAt })
    .from(workDigestState)
    .where(eq(workDigestState.userId, userId))
    .limit(1)
  return r?.lastSentAt ?? null
}
