import { dmPeerFromKey } from '@work/lib/channels/dm-peers'
import type { TaskItem, TaskRow } from './types'

/** TASK_COLUMNS 로 읽은 행(채널·담당자 임베드 포함) → 화면용 TaskItem */
export type TaskQueryRow = Pick<
  TaskRow,
  | 'id'
  | 'channel_id'
  | 'message_id'
  | 'title'
  | 'note'
  | 'assignee_id'
  | 'due_on'
  | 'status'
  | 'created_by'
  | 'completed_at'
  | 'created_at'
> & {
  channel: {
    name: string
    slug: string | null
    kind: TaskItem['channel_kind']
    dm_key?: string | null
    archived_at?: string | null
    is_group?: boolean | null
    title?: string | null
  } | null
  assignee: { display_name: string } | null
}

/** meId 를 알면 1:1 다이렉트 메시지 상대 id 도 구한다(이름은 listTasks 가 조회해 applyChatLabels 로 붙인다) */
export function toTaskItem(row: TaskQueryRow, meId?: string): TaskItem {
  const ch = row.channel
  return {
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel?.name ?? '(알 수 없는 채널)',
    channel_slug: row.channel?.slug ?? null,
    channel_kind: row.channel?.kind ?? 'public',
    message_id: row.message_id,
    title: row.title,
    note: row.note,
    assignee_id: row.assignee_id,
    assignee_name: row.assignee?.display_name ?? null,
    due_on: row.due_on,
    status: row.status === 'done' ? 'done' : 'open',
    created_by: row.created_by,
    completed_at: row.completed_at,
    created_at: row.created_at,
    channel_archived: ch?.archived_at != null,
    ...(ch?.kind === 'dm'
      ? {
          chat_group: Boolean(ch.is_group),
          chat_group_title: ch.title?.trim() || null,
          chat_peer_id: !ch.is_group && meId ? dmPeerFromKey(ch.dm_key ?? null, meId) : null,
        }
      : {}),
  }
}

/** 대화 채널 할 일에 표시 라벨을 붙인다(peerNames: user_id → 이름). 대화가 아닌 항목은 그대로. */
export function applyChatLabels(tasks: TaskItem[], peerNames: Map<string, string>): TaskItem[] {
  return tasks.map(t => {
    if (t.channel_kind !== 'dm') return t
    let label: string
    if (t.chat_group) {
      label = t.chat_group_title ? `그룹 채팅 · ${t.chat_group_title}` : '그룹 채팅'
    } else {
      const name = t.chat_peer_id ? peerNames.get(t.chat_peer_id) : undefined
      label = name ? `다이렉트 메시지 · ${name}` : '다이렉트 메시지'
    }
    return { ...t, chat_label: label }
  })
}
