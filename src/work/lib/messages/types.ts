import type { Database } from '@work/types/supabase'

export type AttachmentRow = Database['work']['Tables']['attachments']['Row']

export type MessageRow = Database['work']['Tables']['messages']['Row']
export type ReactionRow = Database['work']['Tables']['reactions']['Row']

/** 화면에서 쓰는 반응 한 건(메시지 안에 모아 둔다) */
export type ReactionLite = { emoji: string; user_id: string }

/**
 * 인용 대상 요약(임베드). 읽을 수 없거나(권한) 하드 삭제됐으면 ChatMessage.quoted 가 null 이다.
 * body 는 카드에 앞 몇 줄만 쓰므로 서버가 QUOTE_BODY_MAX 로 잘라 보낸다.
 */
export type QuotedRef = {
  id: string
  author_id: string | null
  kind: MessageRow['kind']
  body: string
  deleted_at: string | null
  /** 스레드 답글이면 부모 id — 링크가 ?thread= 로 간다 */
  parent_id: string | null
}

/** 전달 원본 요약(임베드). 읽을 수 없으면 ChatMessage.forwarded 가 null("볼 수 없음") */
export type ForwardedRef = {
  id: string
  channel_id: string
  parent_id: string | null
  deleted_at: string | null
  /** 원문 링크용(채널 slug·종류) */
  channel: { slug: string | null; kind: string } | null
}

/** 인용 카드에 싣는 본문 길이 상한 */
export const QUOTE_BODY_MAX = 400

/** 타임라인·스레드의 메시지 한 건(서버 조회·실시간 레코드 모두 이 모양으로 맞춘다) */
export type ChatMessage = {
  id: string
  channel_id: string
  parent_id: string | null
  author_id: string | null
  kind: MessageRow['kind']
  body: string
  attachments_count: number
  reply_count: number
  last_reply_at: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  reactions: ReactionLite[]
  /** 첨부(서버 조회는 임베드, 실시간 레코드는 기존 값을 이어받고 attachments_count 로 다시 읽는다) */
  attachments: AttachmentRow[]
  /** 인용 답장 대상 id(0028). 없으면 null/undefined */
  quoted_message_id?: string | null
  /** 인용 대상 요약 — quoted_message_id 가 있는데 null 이면 원본을 볼 수 없다(삭제·권한 없음) */
  quoted?: QuotedRef | null
  /** 전달 원본 id(0028) */
  forwarded_from_id?: string | null
  /** 전달 원본 요약 — forwarded_from_id 가 있는데 null 이면 원본을 볼 수 없다 */
  forwarded?: ForwardedRef | null
  /** 낙관적 전송 상태(서버 확정 전 pending, 실패 failed). 서버 행은 undefined */
  status?: 'pending' | 'failed'
}

/** 타임라인 커서(created_at, id) — 이보다 오래된 것을 가져온다 */
export type MessageCursor = { created_at: string; id: string }

export type MessagePage = {
  /** 오래된 것 → 최신 순 */
  messages: ChatMessage[]
  /** 더 오래된 메시지가 있는가 */
  hasMore: boolean
}

export const MESSAGE_PAGE_SIZE = 50

/** select 열 — 서버 조회·실시간 레코드 정규화가 같은 열을 쓴다 */
export const MESSAGE_COLUMNS =
  'id, channel_id, parent_id, author_id, kind, body, attachments_count, reply_count, last_reply_at, edited_at, deleted_at, created_at, quoted_message_id, forwarded_from_id, quoted:quoted_message_id(id, author_id, kind, body, deleted_at, parent_id), forwarded:forwarded_from_id(id, channel_id, parent_id, deleted_at, channel:channels!messages_channel_id_fkey(slug, kind)), reactions(emoji, user_id), attachments(id, message_id, channel_id, uploader_id, bucket_path, name, mime, size, width, height, created_at, folder_path, previous_attachment_id, version_root_id, version_no, is_latest)' as const

/** 첨부만 따로 읽을 때(실시간 갱신) 쓰는 열 */
export const ATTACHMENT_COLUMNS =
  'id, message_id, channel_id, uploader_id, bucket_path, name, mime, size, width, height, created_at, folder_path, previous_attachment_id, version_root_id, version_no, is_latest' as const

/** 첨부를 올린 순서(created_at, id)로 정렬 */
export function sortAttachments(list: AttachmentRow[]): AttachmentRow[] {
  return [...list].sort((a, b) =>
    a.created_at === b.created_at
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.created_at < b.created_at
        ? -1
        : 1
  )
}
