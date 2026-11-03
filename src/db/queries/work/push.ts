/**
 * 업무툴 웹 푸시 쿼리 계층 — 원본 kosmart-work `work.push_subscriptions`와 RPC `push_recipients`(0005·0027)를 옮겼다
 * (설계 §5·§8-4).
 *
 * **권한을 모른다.** 구독 쓰기는 늘 인자로 받은 userId의 행만 바꾼다(원본 harden_push_subscriptions_write가
 * user_id를 auth.uid()로 강제한 자리). "남의 endpoint면 409"·"이사회 권한이 있나"는 라우트가 판정한다.
 *
 * `listPushCandidates`는 원본 push_recipients의 **후보 모으기**까지만 한다(사유별 후보 + 멤버십·알림 수준·방해 금지·
 * 이사회 권한 원자료). 어떤 후보에게 실제로 보낼지(알림 수준·방해 금지·작성자 제외·읽기 범위)는 순수 함수
 * `src/work/lib/push/recipients.ts`가 정한다 — 규칙을 DB 없이 시험하려고 나눴다.
 */
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  memberProfiles,
  workChannelMembers,
  workChannels,
  workMemberPrefs,
  workMentions,
  workMessages,
  workPushSubscriptions,
} from '../../schema/index.ts'

const IN_CHUNK = 200

function chunks<T>(list: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── 구독 ──────────────────────────────────────────────────────────────────────

export type PushSubscriptionRow = {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  lastSeenAt: Date
}

/** endpoint의 현재 주인(없으면 null) — 라우트가 "남의 endpoint" 409를 판정한다 */
export async function findPushSubscriptionOwner(
  endpoint: string
): Promise<{ userId: string; lastSeenAt: Date } | null> {
  const [r] = await db
    .select({ userId: workPushSubscriptions.userId, lastSeenAt: workPushSubscriptions.lastSeenAt })
    .from(workPushSubscriptions)
    .where(eq(workPushSubscriptions.endpoint, endpoint))
    .limit(1)
  return r ?? null
}

/**
 * endpoint 유일 upsert. 충돌하면 행의 주인을 **이 userId로 바꾼다** — 남의 것인지(409)·버려진 것인지(90일)는
 * 호출 라우트가 먼저 판정해야 한다(원본 /api/push/subscribe의 service_role upsert와 같다).
 */
export async function upsertPushSubscription(input: {
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()
  await db
    .insert(workPushSubscriptions)
    .values({
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: workPushSubscriptions.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        lastSeenAt: now,
      },
    })
}

/** 내 구독 하나 해지(남의 endpoint는 0행). 지운 행 수 */
export async function deleteMyPushSubscription(userId: string, endpoint: string): Promise<number> {
  const rows = await db
    .delete(workPushSubscriptions)
    .where(
      and(eq(workPushSubscriptions.userId, userId), eq(workPushSubscriptions.endpoint, endpoint))
    )
    .returning({ id: workPushSubscriptions.id })
  return rows.length
}

/** 이 endpoint가 "내 구독"으로 등록돼 있는가 */
export async function isMyPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const [r] = await db
    .select({ id: workPushSubscriptions.id })
    .from(workPushSubscriptions)
    .where(
      and(eq(workPushSubscriptions.userId, userId), eq(workPushSubscriptions.endpoint, endpoint))
    )
    .limit(1)
  return Boolean(r)
}

export async function listPushSubscriptionsFor(
  userIds: readonly string[]
): Promise<PushSubscriptionRow[]> {
  const ids = [...new Set(userIds)]
  const out: PushSubscriptionRow[] = []
  for (const chunk of chunks(ids)) {
    out.push(
      ...(await db
        .select({
          id: workPushSubscriptions.id,
          userId: workPushSubscriptions.userId,
          endpoint: workPushSubscriptions.endpoint,
          p256dh: workPushSubscriptions.p256dh,
          auth: workPushSubscriptions.auth,
          lastSeenAt: workPushSubscriptions.lastSeenAt,
        })
        .from(workPushSubscriptions)
        .where(inArray(workPushSubscriptions.userId, chunk)))
    )
  }
  return out
}

/** 만료(404·410) 구독 삭제 */
export async function deletePushSubscriptionsByIds(ids: readonly string[]): Promise<number> {
  let n = 0
  for (const chunk of chunks([...new Set(ids)])) {
    const rows = await db
      .delete(workPushSubscriptions)
      .where(inArray(workPushSubscriptions.id, chunk))
      .returning({ id: workPushSubscriptions.id })
    n += rows.length
  }
  return n
}

/** 발송 성공한 구독의 last_seen_at 갱신(90일 정리 대상에서 뺀다) */
export async function touchPushSubscriptions(ids: readonly string[], now = new Date()) {
  for (const chunk of chunks([...new Set(ids)])) {
    await db
      .update(workPushSubscriptions)
      .set({ lastSeenAt: now })
      .where(inArray(workPushSubscriptions.id, chunk))
  }
}

/** last_seen_at이 before보다 이른 구독 삭제(원본 cleanupStalePushSubscriptions). 지운 행 수 */
export async function deleteStalePushSubscriptions(before: Date): Promise<number> {
  const rows = await db
    .delete(workPushSubscriptions)
    .where(lt(workPushSubscriptions.lastSeenAt, before))
    .returning({ id: workPushSubscriptions.id })
  return rows.length
}

// ── 수신자 후보(원본 push_recipients의 cand CTE + 조인) ─────────────────────────

export type PushReason = 'mention' | 'dm' | 'thread' | 'channel'

export type PushMessageFacts = {
  id: string
  channelId: string
  channelKind: 'public' | 'private' | 'dm'
  parentId: string | null
  authorId: string | null
}

export type PushCandidate = {
  userId: string
  /** 그 채널 멤버십 역할(멤버가 아니면 null) */
  memberRole: 'owner' | 'member' | null
  /** 저장된 알림 수준(null = 기본) */
  notifyLevel: string | null
  /** 방해 금지 설정(행이 없으면 null → 기본값) */
  quiet: { enabled: boolean; start: number; end: number; weekends: boolean } | null
  /** 이 메시지에 멘션됐는가 */
  mentioned: boolean
  /** 이사회 권한 판정 원자료(member_profiles). 프로필이 없으면 null */
  profile: {
    registration_status: string | null
    is_active: boolean
    is_admin: boolean
    is_director: boolean
    is_auditor: boolean
  } | null
}

function normalizeKind(kind: string): PushMessageFacts['channelKind'] {
  return kind === 'private' || kind === 'dm' ? kind : 'public'
}

/**
 * 사유별 후보와 판정 원자료. 메시지가 없거나 지워졌으면 null(원본 msg CTE의 `deleted_at is null`).
 *   mention  이 메시지의 멘션 행 사용자
 *   dm       DM·그룹 채널의 멤버
 *   channel  일반 채널(DM 아님)의 최상위 글 → 채널 멤버
 *   thread   답글이면 부모 작성자 + 같은 스레드의 (지워지지 않은) 답글 작성자
 */
export async function listPushCandidates(
  messageId: string,
  reason: PushReason
): Promise<{ message: PushMessageFacts; candidates: PushCandidate[] } | null> {
  const [m] = await db
    .select({
      id: workMessages.id,
      channelId: workMessages.channelId,
      parentId: workMessages.parentId,
      authorId: workMessages.authorId,
      kind: workChannels.kind,
    })
    .from(workMessages)
    .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
    .where(and(eq(workMessages.id, messageId), isNull(workMessages.deletedAt)))
    .limit(1)
  if (!m) return null
  const message: PushMessageFacts = {
    id: m.id,
    channelId: m.channelId,
    channelKind: normalizeKind(m.kind),
    parentId: m.parentId,
    authorId: m.authorId,
  }

  const uids = new Set<string>()
  if (reason === 'mention') {
    const rows = await db
      .select({ userId: workMentions.userId })
      .from(workMentions)
      .where(eq(workMentions.messageId, m.id))
    for (const r of rows) uids.add(r.userId)
  } else if (
    (reason === 'dm' && message.channelKind === 'dm') ||
    (reason === 'channel' && message.channelKind !== 'dm' && !message.parentId)
  ) {
    const rows = await db
      .select({ userId: workChannelMembers.userId })
      .from(workChannelMembers)
      .where(eq(workChannelMembers.channelId, m.channelId))
    for (const r of rows) uids.add(r.userId)
  } else if (reason === 'thread' && message.parentId) {
    const [parent] = await db
      .select({ authorId: workMessages.authorId })
      .from(workMessages)
      .where(eq(workMessages.id, message.parentId))
      .limit(1)
    if (parent?.authorId) uids.add(parent.authorId)
    const replies = await db
      .select({ authorId: workMessages.authorId })
      .from(workMessages)
      .where(and(eq(workMessages.parentId, message.parentId), isNull(workMessages.deletedAt)))
    for (const r of replies) if (r.authorId) uids.add(r.authorId)
  }
  if (uids.size === 0) return { message, candidates: [] }

  const ids = [...uids]
  const candidates: PushCandidate[] = []
  for (const chunk of chunks(ids)) {
    const rows = await db
      .select({
        userId: memberProfiles.id,
        role: workChannelMembers.role,
        notifyLevel: workChannelMembers.notifyLevel,
        quietEnabled: workMemberPrefs.quietEnabled,
        quietStart: workMemberPrefs.quietStart,
        quietEnd: workMemberPrefs.quietEnd,
        quietWeekends: workMemberPrefs.quietWeekends,
        registrationStatus: memberProfiles.registrationStatus,
        isActive: memberProfiles.isActive,
        isAdmin: memberProfiles.isAdmin,
        isDirector: memberProfiles.isDirector,
        isAuditor: memberProfiles.isAuditor,
        mentioned: sql<number>`exists (select 1 from ${workMentions} mm where mm.message_id = ${m.id} and mm.user_id = ${memberProfiles.id})`,
      })
      .from(memberProfiles)
      .leftJoin(
        workChannelMembers,
        and(
          eq(workChannelMembers.channelId, m.channelId),
          eq(workChannelMembers.userId, memberProfiles.id)
        )
      )
      .leftJoin(workMemberPrefs, eq(workMemberPrefs.userId, memberProfiles.id))
      .where(inArray(memberProfiles.id, chunk))
    for (const r of rows) {
      candidates.push({
        userId: r.userId,
        memberRole: r.role === 'owner' ? 'owner' : r.role === 'member' ? 'member' : null,
        notifyLevel: r.notifyLevel,
        quiet:
          r.quietEnabled === null
            ? null
            : {
                enabled: Boolean(r.quietEnabled),
                start: Number(r.quietStart),
                end: Number(r.quietEnd),
                weekends: Boolean(r.quietWeekends),
              },
        mentioned: Boolean(Number(r.mentioned)),
        profile: {
          registration_status: r.registrationStatus,
          is_active: r.isActive,
          is_admin: r.isAdmin,
          is_director: r.isDirector,
          is_auditor: r.isAuditor,
        },
      })
    }
  }
  return { message, candidates }
}

/** 푸시 본문을 만들 원자료(원본 notify.ts loadInfo). 지워졌으면 null */
export async function loadPushMessageInfo(messageId: string): Promise<{
  messageId: string
  parentId: string | null
  channelId: string
  channelName: string
  channelSlug: string | null
  channelKind: 'public' | 'private' | 'dm'
  isGroup: boolean
  groupTitle: string | null
  authorName: string | null
  messageKind: string
  body: string
  sensitive: boolean
} | null> {
  const [r] = await db
    .select({
      id: workMessages.id,
      parentId: workMessages.parentId,
      channelId: workChannels.id,
      channelName: workChannels.name,
      channelSlug: workChannels.slug,
      channelKind: workChannels.kind,
      isGroup: workChannels.isGroup,
      groupTitle: workChannels.title,
      authorName: memberProfiles.displayName,
      kind: workMessages.kind,
      body: workMessages.body,
      sensitive: workMessages.sensitive,
    })
    .from(workMessages)
    .innerJoin(workChannels, eq(workChannels.id, workMessages.channelId))
    .leftJoin(memberProfiles, eq(memberProfiles.id, workMessages.authorId))
    .where(and(eq(workMessages.id, messageId), isNull(workMessages.deletedAt)))
    .limit(1)
  if (!r) return null
  return {
    messageId: r.id,
    parentId: r.parentId,
    channelId: r.channelId,
    channelName: r.channelName,
    channelSlug: r.channelSlug,
    channelKind: normalizeKind(r.channelKind),
    isGroup: r.isGroup,
    groupTitle: r.groupTitle,
    authorName: r.authorName,
    messageKind: r.kind,
    body: r.body,
    sensitive: r.sensitive,
  }
}

/** 이사회 권한 판정 원자료(주인들의 member_profiles) — 크론 등에서 일괄로 다시 본다 */
export async function listProfileFlags(userIds: readonly string[]): Promise<
  Map<
    string,
    {
      registration_status: string | null
      is_active: boolean
      is_admin: boolean
      is_director: boolean
      is_auditor: boolean
    }
  >
> {
  const out = new Map()
  for (const chunk of chunks([...new Set(userIds)])) {
    const rows = await db
      .select({
        id: memberProfiles.id,
        registrationStatus: memberProfiles.registrationStatus,
        isActive: memberProfiles.isActive,
        isAdmin: memberProfiles.isAdmin,
        isDirector: memberProfiles.isDirector,
        isAuditor: memberProfiles.isAuditor,
      })
      .from(memberProfiles)
      .where(inArray(memberProfiles.id, chunk))
    for (const r of rows) {
      out.set(r.id, {
        registration_status: r.registrationStatus,
        is_active: r.isActive,
        is_admin: r.isAdmin,
        is_director: r.isDirector,
        is_auditor: r.isAuditor,
      })
    }
  }
  return out
}
