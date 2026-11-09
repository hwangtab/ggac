export interface InboundEmail {
  id: string
  resend_email_id: string
  message_id: string | null
  from_address: string
  /** 정규화한 주소(0037). 발신자 필터의 값이다. */
  from_email: string | null
  from_name: string | null
  to_addresses: string
  cc_addresses: string
  received_for: string
  subject: string | null
  status: 'unread' | 'read' | 'replied' | 'archived' | 'spam'
  body_fetch_status: 'pending' | 'done' | 'attachments_failed' | 'attachments_expired' | 'failed'
  thread_references: string | null
  received_at: string
  created_at: string
  updated_at: string
  /** 목록 응답에만 있다. 인라인 이미지는 세지 않는다. */
  attachment_count?: number
  /** 대화를 시작한 받은 메일의 id(0038). */
  thread_id: string | null
  /** 목록 응답에만 있다. 같은 대화의 받은 메일 수(자기 포함). */
  thread_count?: number
  /** 목록 응답에만 있다. 내부 메모 수. */
  note_count?: number
  /** 담당자(0041)와 그 표시 이름. */
  assigned_to?: string | null
  assignee_name?: string | null
  /** 붙은 라벨(0042). 목록과 상세 둘 다 싣는다. */
  labels?: { id: string; name: string; color: string }[]
  /** 다시 알림 시각(0044). 지나면 크론이 비운다. */
  snoozed_until?: string | null
  /** 이 메일이 우리가 새로 작성해 보낸 메일에 온 답장이면 그 보낸 메일의 id(0047). */
  reply_to_outbound_id?: string | null
  /** 상세 응답에만 있다 — 답장이 가리키는 보낸 메일의 머리글. */
  sent_reply_to?: SentReplySource | null
}

/** 상세 응답의 `sent_reply_to` — 답장이 가리키는 보낸 메일의 머리글. */
export interface SentReplySource {
  id: string
  subject: string
  sent_at: string | null
  sent_by_email: string | null
}

/** 다시 알림 중인가 — 시각이 아직 안 지났다(크론이 비우기 전 잠깐은 지난 값이 남아 있을 수 있다). */
export function isSnoozed(email: Pick<InboundEmail, 'snoozed_until'>): boolean {
  return Boolean(email.snoozed_until && Date.parse(email.snoozed_until) > Date.now())
}

export type AssigneeOption = {
  id: string
  display_name: string
  role: 'admin' | 'director' | 'auditor'
}
export const ROLE_LABELS: Record<AssigneeOption['role'], string> = {
  admin: '관리자',
  director: '이사',
  auditor: '감사',
}

/** 내부 메모 — 이사·감사·관리자만 본다. 메일로 나가지 않는다. */
export interface MailboxNote {
  id: string
  email_id: string
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string | null
  updated_at: string | null
}

/** 상세 응답의 `thread` — 같은 대화의 받은 메일과 우리 답장, 시간순. 본문은 없다. */
export type ThreadItem =
  | {
      kind: 'inbound'
      id: string
      from_email: string | null
      from_name: string | null
      from_address: string
      subject: string | null
      status: InboundEmail['status']
      at: string | null
    }
  | { kind: 'reply'; id: string; email_id: string; subject: string; at: string | null }

/** `GET /api/admin/mailbox/sender`. `member`는 가입한 회원이 아니면 null이다. */
export interface SenderCard {
  sender: {
    email: string
    name: string | null
    inbound_count: number
    first_received_at: string | null
    last_received_at: string | null
    reply_count: number
    sent_count: number
  }
  member: {
    display_name: string
    registration_status: string
    is_active: boolean
  } | null
}

export interface InboundEmailDetail extends InboundEmail {
  body_html: string | null
  body_text: string | null
  headers: string | null
}

export interface SentReply {
  id: string
  email_id: string
  sent_by: string | null
  subject: string
  body_html: string
  resend_message_id: string | null
  created_at: string
}

export interface Attachment {
  id: string
  email_id: string
  filename: string
  content_type: string | null
  content_id: string | null
  size_bytes: number | null
  blob_path: string
  created_at: string
}

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  unread: { label: '안 읽음', color: 'bg-blue-100 text-blue-800' },
  read: { label: '읽음', color: 'bg-gray-100 text-gray-700' },
  replied: { label: '답장함', color: 'bg-green-100 text-green-800' },
  archived: { label: '보관', color: 'bg-purple-100 text-purple-700' },
  spam: { label: '스팸', color: 'bg-red-100 text-red-800' },
}

export const STATUS_ORDER: InboundEmail['status'][] = [
  'unread',
  'read',
  'replied',
  'archived',
  'spam',
]

export const LIMIT = 30

export const REGISTRATION_LABELS: Record<string, string> = {
  pending: '승인 대기',
  rejected: '거절',
  withdrawn: '탈퇴',
  withdrawal_requested: '탈퇴 신청',
}
/** 발신자 필터 — 주소 하나(`from`) 또는 같은 기관(`domain`). URL 쿼리와 같은 이름이다. */
export type SenderFilter = { kind: 'from' | 'domain'; value: string }

export function readSenderFilterFromUrl(): SenderFilter | null {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from')?.trim()
  if (from) return { kind: 'from', value: from.toLowerCase() }
  const domain = params.get('domain')?.trim()
  if (domain) return { kind: 'domain', value: domain.replace(/^@/, '').toLowerCase() }
  return null
}

export function senderAddress(email: InboundEmail): string {
  return email.from_email || email.from_address
}

export function senderDomain(email: InboundEmail): string | null {
  const address = email.from_email
  if (!address) return null
  const at = address.lastIndexOf('@')
  return at >= 0 && at < address.length - 1 ? address.slice(at + 1) : null
}

export const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'
