import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { listChannelAccess } from '@/db/queries/work/access'
import { getDisplayNames } from '@/db/queries/work/directory'
import {
  countMyOpenTaskRecords,
  listChannelMemberIdsFor,
  listTaskRecordsForViewer,
} from '@/db/queries/work/tasks'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { listSidebarChannels, listStaffDirectory } from '@work/lib/channels/queries'
import { applyChatLabels, toTaskItem } from './map'
import type { TaskChannelOption, TaskItem, TaskStaffOption } from './types'

/**
 * 할 일 조회(서버 전용) — 원본 kosmart-work `lib/tasks/queries.ts`와 같은 이름·결과 모양.
 * 원본 RLS(tasks_select = can_read_channel)의 거르기는 읽기 범위(`readableChannelIds`)를 쿼리 계층에 넘겨 한다.
 * '내 것'은 인자로 받은 userId가 아니라 **가드의 사용자**로 읽는다(남의 id를 넘겨도 결과가 바뀌지 않게).
 */

/**
 * /tasks 가 쓰는 목록: 내 것(담당=나 또는 생성=나) ∪ 내가 읽을 수 있는 채널의 것.
 * 미완료는 상한 500, 완료는 최근 50건씩. `openTruncated` 가 true 면 미완료가 상한을 넘어 일부만 읽은 것이다.
 */
export async function listTasks(
  supabase: WorkServerClient,
  _userId: string
): Promise<{ tasks: TaskItem[]; openTruncated: boolean }> {
  const userId = supabase.user.id
  const readable = await readableChannelIds(viewerOf(supabase))
  const { rows, openTruncated } = await listTaskRecordsForViewer({ userId, readable })
  const items = rows.map(r => toTaskItem(r, userId))
  // 1:1 다이렉트 메시지 할 일은 묶음 이름이 모두 "다이렉트 메시지"가 되지 않게 상대 이름을 붙인다(실패해도 화면은 그린다)
  const peerIds = [
    ...new Set(items.map(t => t.chat_peer_id).filter((id): id is string => Boolean(id))),
  ]
  let peerNames = new Map<string, string>()
  try {
    peerNames = await getDisplayNames(peerIds)
  } catch (e) {
    console.error('[tasks] 다이렉트 메시지 상대 이름:', e)
  }
  return { tasks: applyChatLabels(items, peerNames), openTruncated }
}

/** 내가 owner 인 채널 id(할 일 수정·완료 권한 표시용 — 서버 액션·쿼리 계층이 다시 막는다) */
export async function listOwnedChannelIds(
  supabase: WorkServerClient,
  _userId: string
): Promise<string[]> {
  const rows = await listChannelAccess(supabase.user.id)
  return rows.filter(r => r.memberRole === 'owner').map(r => r.id)
}

/**
 * 사이드바 배지: 내 미완료 수(담당=나 또는 내가 만들고 담당 없음). 보관 채널의 할 일은 뺀다.
 * 실패해도 화면을 죽이지 않는다(0, 로그) — 원본 soft.
 */
export async function countMyOpenTasks(
  supabase: WorkServerClient,
  _userId: string
): Promise<number> {
  try {
    const readable = await readableChannelIds(viewerOf(supabase))
    return await countMyOpenTaskRecords({ userId: supabase.user.id, readable })
  } catch (e) {
    console.error('[tasks] 내 미완료 할 일 수:', e)
    return 0
  }
}

/** 새 할 일 폼의 채널 선택지: 내가 멤버인 채널·DM(쓰기는 멤버만 가능) */
export async function listTaskChannelOptions(
  supabase: WorkServerClient,
  userId: string
): Promise<TaskChannelOption[]> {
  const { channels, dms } = await listSidebarChannels(supabase, userId)
  return [...channels, ...dms].map(c => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    group: c.group,
  }))
}

/**
 * 담당자 선택지: 활성 구성원(지금 이사·감사·관리자). 채널별로는 assigneeCandidates 가 좁힌다.
 * 게스트에게는 공동 멤버만(원본 0026 staff_select — `listStaffDirectory`가 같은 규칙으로 거른다).
 */
export async function listTaskStaffOptions(supabase: WorkServerClient): Promise<TaskStaffOption[]> {
  const directory = await listStaffDirectory(supabase)
  return directory
    .filter(s => s.status === 'active')
    .map(s => ({
      user_id: s.user_id,
      display_name: s.display_name,
      guest: s.role === 'guest',
      admin: s.role === 'owner' || s.role === 'admin',
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'))
}

/** 채널별 멤버 id(담당자 후보 계산용). 원본 RLS(channel_members_select)처럼 읽을 수 있는 채널만 */
export async function listTaskChannelMembers(
  supabase: WorkServerClient,
  channelIds: string[]
): Promise<Record<string, string[]>> {
  const readable = await readableChannelIds(viewerOf(supabase))
  const ids = [...new Set(channelIds)]
  const visible = await listChannelMemberIdsFor(ids.filter(id => readable.has(id)))
  const out: Record<string, string[]> = {}
  for (const id of ids) out[id] = visible[id] ?? []
  return out
}
