import { fetchMessagePage, fetchMyBookmarkIds, fetchPinnedIds } from '@work/lib/messages/queries'
import type { MessagePage } from '@work/lib/messages/types'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { getChannelRev, getMyMembership, listChannelMembers, listStaffDirectory } from './queries'
import type { ChannelMemberSummary, MyMembership, StaffSummary } from './types'

/**
 * 채널·DM 화면이 처음 그릴 데이터 묶음(c/[slug]·dm/[id] 페이지 공용) — 원본과 같은 모양 + `rev`.
 * 채널 자체의 열람 권한은 호출 전에 이미 확인됐다(getChannelBySlug·getDmChannel이 null이면 notFound).
 *
 * `rev`(추가): 이 데이터를 읽은 시점의 채널 변경 번호 — 폴링(`/api/board-room/work/sync`)의 시작 커서다
 * (docs/board-work/02-sync.md). 메시지 페이지보다 **먼저** 읽는다: 그 사이에 생긴 변경은 다음 폴링이 다시 알려 준다
 * (늦게 읽으면 그 사이 변경을 놓친다).
 */
export async function loadChannelViewData(
  supabase: WorkServerClient,
  channelId: string,
  userId: string
): Promise<{
  membership: MyMembership | null
  members: ChannelMemberSummary[]
  staff: StaffSummary[]
  page: MessagePage
  pinnedIds: string[]
  bookmarkedIds: string[]
  rev: number
}> {
  const rev = (await getChannelRev(supabase, channelId)) ?? 0
  const [membership, members, staff, page, pinnedIds] = await Promise.all([
    getMyMembership(supabase, channelId, userId),
    listChannelMembers(supabase, channelId),
    listStaffDirectory(supabase),
    fetchMessagePage(supabase, channelId),
    fetchPinnedIds(supabase, channelId),
  ])
  const bookmarkedIds = await fetchMyBookmarkIds(
    supabase,
    userId,
    page.messages.map(m => m.id)
  )
  return { membership, members, staff, page, pinnedIds, bookmarkedIds, rev }
}
