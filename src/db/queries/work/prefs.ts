/**
 * 사용자별 설정·상태 메시지(`work_member_prefs`) — 원본 `work.staff_prefs` + `work.staff`의 상태 열(0027·0030·0031).
 * 권한을 모른다: 늘 **인자로 받은 userId의 행만** 읽고 쓴다(원본 harden_staff_prefs_write가 user_id를 auth.uid()로 강제).
 */
import { eq } from 'drizzle-orm'

import { db } from '../../client.ts'
import { workMemberPrefs } from '../../schema/index.ts'

import { iso } from './_shared.ts'

export type MemberPrefsRecord = {
  quiet_enabled: boolean
  quiet_start: number
  quiet_end: number
  quiet_weekends: boolean
  digest_mode: string
  onboarded_at: string | null
  channel_sort: string
  chat_sort: string
  status_emoji: string | null
  status_text: string | null
  status_until: string | null
  /** 업무 화면에만 보이는 직함(0033). NULL이면 이사회 직함으로 떨어진다 */
  work_title: string | null
  membership_rev: number
  created_at: string | null
}

export async function getMemberPrefsRecord(userId: string): Promise<MemberPrefsRecord | null> {
  const [r] = await db
    .select()
    .from(workMemberPrefs)
    .where(eq(workMemberPrefs.userId, userId))
    .limit(1)
  if (!r) return null
  return {
    quiet_enabled: r.quietEnabled,
    quiet_start: r.quietStart,
    quiet_end: r.quietEnd,
    quiet_weekends: r.quietWeekends,
    digest_mode: r.digestMode,
    onboarded_at: iso(r.onboardedAt),
    channel_sort: r.channelSort,
    chat_sort: r.chatSort,
    status_emoji: r.statusEmoji,
    status_text: r.statusText,
    status_until: iso(r.statusUntil),
    work_title: r.workTitle,
    membership_rev: r.membershipRev,
    created_at: iso(r.createdAt),
  }
}

export type MemberPrefsPatch = Partial<{
  quietEnabled: boolean
  quietStart: number
  quietEnd: number
  quietWeekends: boolean
  digestMode: string
  onboardedAt: Date | null
  channelSort: string
  chatSort: string
  statusEmoji: string | null
  statusText: string | null
  statusUntil: Date | null
  workTitle: string | null
}>

/** 본인 행 upsert(없으면 기본값으로 만들고 patch를 얹는다). membership_rev·created_at은 건드리지 않는다 */
export async function upsertMemberPrefs(userId: string, patch: MemberPrefsPatch): Promise<void> {
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  await db
    .insert(workMemberPrefs)
    .values({ userId, ...set })
    .onConflictDoUpdate({
      target: workMemberPrefs.userId,
      set: Object.keys(set).length > 0 ? set : { userId },
    })
}
