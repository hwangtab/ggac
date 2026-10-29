import { getMemberPrefsRecord, type MemberPrefsRecord } from '@/db/queries/work/prefs'
import {
  DEFAULT_CHANNEL_SORT,
  DEFAULT_CHAT_SORT,
  parseChannelSort,
  parseChatSort,
  type ChannelSort,
  type ChatSort,
} from '@work/lib/channels/sort'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { DEFAULT_QUIET, type DigestMode, type QuietPrefs } from './quiet-hours'

/**
 * 내 알림·안내·정렬 설정 — 원본 kosmart-work `lib/notifications/prefs.ts`와 같은 이름·모양.
 * 원본 `staff_prefs` 자리는 `work_member_prefs`다. 늘 **가드의 사용자** 행만 읽는다(인자 userId는 원본 시그니처 유지용).
 */

/** 내 알림·안내 설정(행이 없으면 기본값). */
export type MyPrefs = {
  quiet: QuietPrefs
  digestMode: DigestMode
  onboardedAt: string | null
}

function toPrefs(row: MemberPrefsRecord | null): MyPrefs {
  if (!row) return { quiet: DEFAULT_QUIET, digestMode: 'off', onboardedAt: null }
  return {
    quiet: {
      enabled: row.quiet_enabled,
      start: row.quiet_start,
      end: row.quiet_end,
      weekends: row.quiet_weekends,
    },
    digestMode:
      row.digest_mode === 'normal' || row.digest_mode === 'hourly' ? row.digest_mode : 'off',
    onboardedAt: row.onboarded_at,
  }
}

/** 설정 화면용 — 조회 실패를 기본값으로 둔갑시키지 않고 던진다. */
export async function getMyPrefs(supabase: WorkServerClient, _userId: string): Promise<MyPrefs> {
  return toPrefs(await getMemberPrefsRecord(supabase.user.id))
}

/** 앱 셸용 — 채널 목록 정렬. 곁가지라 실패하면 기본 '섹션별'(로그) */
export async function getChannelSortPref(
  supabase: WorkServerClient,
  _userId: string
): Promise<ChannelSort> {
  try {
    return parseChannelSort((await getMemberPrefsRecord(supabase.user.id))?.channel_sort)
  } catch (e) {
    console.error('[getChannelSortPref] 채널 정렬 설정 조회 실패:', e)
    return DEFAULT_CHANNEL_SORT
  }
}

/** 앱 셸용 — 채팅(DM·그룹) 목록 정렬. 실패하면 기본 '최근 활동순'(로그) */
export async function getChatSortPref(
  supabase: WorkServerClient,
  _userId: string
): Promise<ChatSort> {
  try {
    return parseChatSort((await getMemberPrefsRecord(supabase.user.id))?.chat_sort)
  } catch (e) {
    console.error('[getChatSortPref] 채팅 정렬 설정 조회 실패:', e)
    return DEFAULT_CHAT_SORT
  }
}

/** 앱 셸용 — 첫 사용 안내를 보여야 하는가. 실패하면 보이지 않음(로그) */
export async function needsOnboarding(
  supabase: WorkServerClient,
  _userId: string
): Promise<boolean> {
  try {
    const row = await getMemberPrefsRecord(supabase.user.id)
    return !row || row.onboarded_at === null
  } catch (e) {
    console.error('[needsOnboarding] 첫 사용 안내 상태 조회 실패:', e)
    return false
  }
}
