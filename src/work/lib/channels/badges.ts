import { countNewActivity, countUnreadMentions } from '@work/lib/inbox/queries'
import type { WorkServerClient } from '@work/lib/supabase/server'
import type { SidebarBadgeSnapshot } from './badge-snapshot'
import { fetchUnreadCounts } from './queries'

/**
 * 사이드바 배지 스냅샷(엄격 — 하나라도 실패하면 던진다). server action `getSidebarBadges`와
 * 폴링 라우트가 같이 쓴다('use server' 파일은 async 함수만 export할 수 있어 따로 둔다).
 */
export async function loadSidebarBadges(supabase: WorkServerClient): Promise<SidebarBadgeSnapshot> {
  const [counts, mentionCount, activityCount] = await Promise.all([
    fetchUnreadCounts(supabase, { strict: true }),
    countUnreadMentions(supabase, supabase.user.id, { strict: true }),
    countNewActivity(supabase, { strict: true }),
  ])
  return { channels: Object.fromEntries(counts), mentionCount, activityCount }
}
