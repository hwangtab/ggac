import { isWorkAdminRole } from '@work/lib/auth/staff'
import type { WorkServerClient } from '@work/lib/supabase/server'
import type { StaffRole } from '@work/lib/channels/types'
import { toTaskItem } from '@work/lib/tasks/map'
import type { TaskItem } from '@work/lib/tasks/types'
import { loadChannelAccess, readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { getChannelRecordById } from '@/db/queries/work/channels'
import { getTabRow, listTabRows, type WorkTabRecord } from '@/db/queries/work/tabs'
import { listTaskRecordsByChannel } from '@/db/queries/work/tasks'
import { APP_TAB_KINDS, type AppTabKind, type FileConfig } from './schema'
import type { ConversationTabItem, TabBarData } from './types'

/**
 * 대화 탭 조회(서버 전용) — 원본 kosmart-work `lib/tabs/queries.ts`와 같은 이름·결과 모양.
 * 원본은 RLS(conversation_tabs_select = can_read_channel)가 걸렀다. 여기서는 가드 결과(`WorkServerClient`)로
 * **읽기 범위를 직접 확인한 뒤** 쿼리 계층(`@/db/queries/work/tabs`)을 부른다 — 읽을 수 없는 대화면 빈 목록/null.
 */

/** 원본 PostgREST select 열(액션이 쓰던 상수 — 이식 뒤에는 쿼리 계층이 같은 열을 읽는다) */
export const TAB_COLUMNS = 'id, channel_id, kind, title, position, config, created_by' as const

type TabRow = Pick<WorkTabRecord, 'id' | 'kind' | 'title' | 'position' | 'config' | 'created_by'>

const APP_KINDS: readonly string[] = APP_TAB_KINDS

/** 앱이 다루는 종류만 화면 모델로 바꾼다(원본 'wiki'·'timeline' 행이 있어도 건너뛴다) */
export function toTabItem(row: TabRow): ConversationTabItem | null {
  if (!APP_KINDS.includes(row.kind)) return null
  return {
    id: row.id,
    kind: row.kind as AppTabKind,
    title: row.title,
    position: row.position,
    config: row.config,
    // ggac 이식: 만든 사람 프로필이 지워졌으면 null(set null) — 화면 판정에서는 누구의 것도 아니다
    createdBy: row.created_by ?? '',
  }
}

/** 원본은 게스트에게 위키 탭을 숨겼다. ggac 이식: 위키 탭이 없어 그대로 돌려준다(이름·모양은 원본 유지) */
export function visibleTabsFor(
  tabs: readonly ConversationTabItem[],
  _role: StaffRole
): ConversationTabItem[] {
  return [...tabs]
}

async function canRead(supabase: WorkServerClient, channelId: string): Promise<boolean> {
  return (await readableChannelIds(viewerOf(supabase))).has(channelId)
}

/** 이 대화의 추가 탭(순서대로). 읽을 수 없는 대화면 빈 목록. 실패를 빈 목록으로 숨기지 않는다(던진다). */
export async function listConversationTabs(
  supabase: WorkServerClient,
  channelId: string,
  role: StaffRole
): Promise<ConversationTabItem[]> {
  if (!(await canRead(supabase, channelId))) return []
  const rows = await listTabRows(channelId)
  const items = rows.map(r => toTabItem(r)).filter((t): t is ConversationTabItem => t !== null)
  return visibleTabsFor(items, role)
}

/** 탭 하나(이 채널 소속일 때만). 없거나 못 읽거나 다른 채널 것이면 null → 호출부가 404 */
export async function getConversationTab(
  supabase: WorkServerClient,
  channelId: string,
  tabId: string,
  role: StaffRole
): Promise<ConversationTabItem | null> {
  if (!(await canRead(supabase, channelId))) return null
  const row = await getTabRow(tabId)
  if (!row || row.channel_id !== channelId) return null
  const item = toTabItem(row)
  if (!item) return null
  return visibleTabsFor([item], role).length > 0 ? item : null
}

/**
 * 탭 바 데이터: 추가 탭 + 내 멤버십(역할) + 보관 여부. '내 것'은 가드의 사용자로 읽는다.
 * ggac 이식: 게스트(서브관리자)는 아직 없어(설계 §3) `hasGuests`는 늘 false.
 * ggac 이식(폴링): 채널 rev(폴링 시작 커서)를 **탭·메모·할 일을 읽기 전에** 먼저 읽어 `rev`로 싣는다 — 화면을 그린 뒤
 * 첫 폴이 오기 전에 누가 메모를 저장해도 그 변경이 커서 뒤에 있어 tabsChanged로 잡힌다(커서를 첫 폴에서 받으면 놓친다).
 */
export async function loadTabBarData(
  supabase: WorkServerClient,
  channelId: string,
  me: { id: string; role: StaffRole }
): Promise<TabBarData> {
  const rev = (await getChannelRecordById(channelId))?.rev ?? null
  const [tabs, access] = await Promise.all([
    listConversationTabs(supabase, channelId, me.role),
    loadChannelAccess(viewerOf(supabase), channelId),
  ])
  return {
    tabs,
    me: { id: me.id, isAdmin: isWorkAdminRole(me.role), isGuest: me.role === 'guest' },
    isMember: access?.isMember ?? false,
    isChannelOwner: access?.isOwner ?? false,
    hasGuests: false,
    archived: access?.archived === true,
    rev: access?.canRead ? rev : null,
  }
}

/** 할 일 탭: 이 채널의 할 일(미완료 전부 상한 500, 완료는 최근 50건). 읽을 수 없으면 빈 목록 */
export async function listChannelTasks(
  supabase: WorkServerClient,
  channelId: string
): Promise<TaskItem[]> {
  if (!(await canRead(supabase, channelId))) return []
  return (await listTaskRecordsByChannel(channelId)).map(row => toTaskItem(row, supabase.user.id))
}

/** 파일 탭 본문에 필요한 첨부 한 건(삭제 여부 포함) */
export type FileTabAttachment = {
  id: string
  name: string
  mime: string
  size: number
  createdAt: string
  /** 첨부가 달린 메시지가 소프트 삭제됨 */
  deleted: boolean
  /** 버전 계보 안 번호(0032, v1 = 1). 계보 정보가 없으면 생략 */
  versionNo?: number
}

export type FileTabData = {
  /** 지금 보여 줄 파일 — 계보의 최신(없으면 탭이 가리키던 첨부). 첨부 행이 없거나 못 읽으면 null */
  current: FileTabAttachment | null
  /** 이전 버전(최신 → 오래된). 읽을 수 없는 id 는 빠진다 */
  history: FileTabAttachment[]
}

/**
 * 파일 탭의 현재·이전 버전 첨부.
 * TODO(이사회 업무툴 2a): 첨부 표·계보(`work_attachments`)는 2a가 옮긴다. 그 전에는 파일 탭이 만들어지지 않으므로
 * (쿼리 층 `attachmentBelongsToChannel`이 늘 거절) 빈 결과를 돌려준다. 2a가 합쳐지면 원본 본문(계보 + config.history)으로 바꾼다.
 */
export async function loadFileTabData(
  _supabase: WorkServerClient,
  _channelId: string,
  _config: FileConfig
): Promise<FileTabData> {
  return { current: null, history: [] }
}

export type FileOption = {
  id: string
  name: string
  mime: string
  size: number
  createdAt: string
}

/**
 * ＋ 대화상자의 "이 대화의 파일에서 고르기" 목록.
 * TODO(이사회 업무툴 2a): 첨부 표가 들어오면 원본 본문(삭제되지 않은 첨부, 최신순, 이름 검색)으로 바꾼다. 지금은 빈 목록.
 */
export async function listConversationFileOptions(
  _supabase: WorkServerClient,
  _channelId: string,
  _q?: string
): Promise<FileOption[]> {
  return []
}
