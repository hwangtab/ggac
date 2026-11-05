'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FiMail,
  FiEdit,
  FiRefreshCw,
  FiSend,
  FiX,
  FiPaperclip,
  FiSearch,
  FiArrowLeft,
  FiUser,
  FiSliders,
} from 'react-icons/fi'

import {
  buildForwardText,
  forwardSubject,
  replyRecipients,
  replySubject,
} from '@/lib/mail/replyCompose'

import ComposeModal, { type ForwardSource } from './ComposeModal'
import SentMailbox from './SentMailbox'
import {
  buildBodySrcDoc,
  escapeHtml,
  formatBytes,
  formatDate,
  hasUntrustedRemoteImage,
} from './mailboxUtils'

interface InboundEmail {
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
}

/** 상세 응답의 `thread` — 같은 대화의 받은 메일과 우리 답장, 시간순. 본문은 없다. */
type ThreadItem =
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
interface SenderCard {
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

interface InboundEmailDetail extends InboundEmail {
  body_html: string | null
  body_text: string | null
  headers: string | null
}

interface SentReply {
  id: string
  email_id: string
  sent_by: string | null
  subject: string
  body_html: string
  resend_message_id: string | null
  created_at: string
}

interface Attachment {
  id: string
  email_id: string
  filename: string
  content_type: string | null
  content_id: string | null
  size_bytes: number | null
  blob_path: string
  created_at: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  unread: { label: '안 읽음', color: 'bg-blue-100 text-blue-800' },
  read: { label: '읽음', color: 'bg-gray-100 text-gray-700' },
  replied: { label: '답장함', color: 'bg-green-100 text-green-800' },
  archived: { label: '보관', color: 'bg-purple-100 text-purple-700' },
  spam: { label: '스팸', color: 'bg-red-100 text-red-800' },
}

const STATUS_ORDER: InboundEmail['status'][] = ['unread', 'read', 'replied', 'archived', 'spam']

const LIMIT = 30

const REGISTRATION_LABELS: Record<string, string> = {
  pending: '승인 대기',
  rejected: '거절',
  withdrawn: '탈퇴',
  withdrawal_requested: '탈퇴 신청',
}

/** 발신자 필터 — 주소 하나(`from`) 또는 같은 기관(`domain`). URL 쿼리와 같은 이름이다. */
type SenderFilter = { kind: 'from' | 'domain'; value: string }

function readSenderFilterFromUrl(): SenderFilter | null {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from')?.trim()
  if (from) return { kind: 'from', value: from.toLowerCase() }
  const domain = params.get('domain')?.trim()
  if (domain) return { kind: 'domain', value: domain.replace(/^@/, '').toLowerCase() }
  return null
}

function senderAddress(email: InboundEmail): string {
  return email.from_email || email.from_address
}

function senderDomain(email: InboundEmail): string | null {
  const address = email.from_email
  if (!address) return null
  const at = address.lastIndexOf('@')
  return at >= 0 && at < address.length - 1 ? address.slice(at + 1) : null
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'

/**
 * 관리자 메일함 화면의 본체 — `admin/mailbox`와 `board-room/mailbox`가
 * 공유한다(브리프 D). props 없이 자기 상태를 갖는다.
 *
 * `can_manage`(목록/상세 API 응답의 최상위 필드, `auth.isAdmin`에서 온다)가
 * false면 상태 변경 버튼·답장 버튼·답장 모달을 **렌더하지 않는다** — 숨기는
 * 게 아니라 안 그린다. 이사·감사는 열람만 하고 답장·상태 변경은 관리자만
 * 한다는 국장 결정(브리프 목표) 때문이다.
 *
 * 구조는 메일 클라이언트 표준 2단(좌 목록 / 우 상세)이다. 좁은 화면
 * (`lg` 미만)에서는 목록과 상세 중 하나만 보이고, 전환은 별도 상태 없이
 * `selectedId !== null`로 판정한다.
 *
 * 루트 높이는 이 컴포넌트가 정하지 않는다 — `admin/mailbox`와
 * `board-room/mailbox`가 서로 다른 레이아웃 크롬(헤더·푸터·사이드 메뉴 높이가
 * 다르다) 안에서 이 화면을 공유하므로, 고정 calc 하나로는 양쪽에 맞지
 * 않는다. 각 페이지가 `className`으로 자기 크롬에 맞는 높이를 넘긴다.
 */
export default function MailboxView({ className = '' }: { className?: string }) {
  const [emails, setEmails] = useState<InboundEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [updating, setUpdating] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  // 발신자 필터는 URL(`?from=`·`?domain=`)이 정본이다 — 뒤로 가기로 풀리고 링크로 공유된다. 서버 렌더에는
  // `window`가 없어 마운트 뒤에 읽고, 그 전에는 목록을 부르지 않는다(필터 없는 목록이 한 번 깜빡이지 않게).
  const [senderFilter, setSenderFilter] = useState<SenderFilter | null>(null)
  const [urlReady, setUrlReady] = useState(false)
  const [senderCard, setSenderCard] = useState<SenderCard | null>(null)
  // 상세 검색 — 첨부·기간. 날짜는 `<input type="date">`의 `YYYY-MM-DD`를 그대로 보내고 서버가 서울 기준으로 읽는다.
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [hasAttachment, setHasAttachment] = useState(false)
  const [afterDate, setAfterDate] = useState('')
  const [beforeDate, setBeforeDate] = useState('')
  const [composeTo, setComposeTo] = useState<string[] | undefined>(undefined)
  const [composeForward, setComposeForward] = useState<ForwardSource | undefined>(undefined)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InboundEmailDetail | null>(null)
  // 메일별로 켜고, 다른 메일을 고르면 다시 꺼진다 — 한 번의 허용이 다음
  // 메일의 추적 픽셀까지 열어 주면 안 된다.
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [replies, setReplies] = useState<SentReply[]>([])
  const [thread, setThread] = useState<ThreadItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // 받은 편지함 / 보낸 편지함. 보낸 편지함은 이사·감사도 열람한다.
  const [view, setView] = useState<'inbox' | 'sent'>('inbox')
  const [sentTotal, setSentTotal] = useState(0)
  const [sentRefresh, setSentRefresh] = useState(0)
  // 새 메일 작성은 관리자 + 서버 스위치(MAILBOX_COMPOSE_ENABLED)가 모두 켜졌을 때만 그린다.
  const [composeEnabled, setComposeEnabled] = useState(false)
  const [composeQuota, setComposeQuota] = useState<{ used: number; limit: number } | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)

  const [replyTarget, setReplyTarget] = useState<InboundEmail | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyAll, setReplyAll] = useState(false)
  const [includeQuote, setIncludeQuote] = useState(true)

  const fetchEmails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('search', search)
      if (senderFilter) params.set(senderFilter.kind, senderFilter.value)
      if (hasAttachment) params.set('has', 'attachment')
      if (afterDate) params.set('after', afterDate)
      if (beforeDate) params.set('before', beforeDate)
      params.set('limit', String(LIMIT))
      params.set('offset', String(offset))

      const res = await fetch(`/api/admin/mailbox?${params}`)
      if (res.status === 400) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || '검색 조건이 올바르지 않습니다.')
      }
      if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.')
      const json = await res.json()
      setEmails(json.data?.emails ?? [])
      setTotalCount(json.data?.pagination?.total_count ?? 0)
      setCanManage(json.data?.can_manage === true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search, offset, senderFilter, hasAttachment, afterDate, beforeDate])

  // 발신자 카드 — 주소 필터일 때만. 카드가 실패해도 목록은 그대로 보여야 하므로 오류는 카드만 지운다.
  useEffect(() => {
    if (senderFilter?.kind !== 'from') {
      setSenderCard(null)
      return
    }
    let cancelled = false
    setSenderCard(null)
    fetch(`/api/admin/mailbox/sender?email=${encodeURIComponent(senderFilter.value)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (!cancelled) setSenderCard(json?.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setSenderCard(null)
      })
    return () => {
      cancelled = true
    }
  }, [senderFilter])

  useEffect(() => {
    if (urlReady) fetchEmails()
  }, [fetchEmails, urlReady])

  useEffect(() => {
    const sync = () => {
      setSenderFilter(readSenderFilterFromUrl())
      setOffset(0)
    }
    sync()
    setUrlReady(true)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // `onMeta`가 SentMailbox의 effect 의존성이라 참조가 안정적이어야 한다 — 아니면 매 렌더마다 다시 읽는다.
  const handleSentMeta = useCallback(({ total }: { total: number }) => setSentTotal(total), [])

  const fetchComposeMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mailbox/outbound?limit=1')
      if (!res.ok) return
      const json = await res.json()
      setComposeEnabled(json.data?.compose_enabled === true)
      setComposeQuota(json.data?.quota ?? null)
    } catch {
      // 작성 버튼이 안 뜰 뿐이다 — 화면 전체를 막을 일이 아니다.
    }
  }, [])

  useEffect(() => {
    if (canManage) fetchComposeMeta()
  }, [canManage, fetchComposeMeta])

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const res = await fetch(`/api/admin/mailbox/${id}`)
      if (!res.ok) throw new Error('상세를 불러오지 못했습니다.')
      const json = await res.json()
      setDetail(json.data?.email ?? null)
      setAttachments(json.data?.attachments ?? [])
      setReplies(json.data?.replies ?? [])
      setThread(json.data?.thread ?? [])
      setCanManage(json.data?.can_manage === true)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const selectEmail = (email: Pick<InboundEmail, 'id' | 'status'>) => {
    setSelectedId(email.id)
    setDetail(null)
    setAttachments([])
    setReplies([])
    setThread([])
    setShowRemoteImages(false)
    fetchDetail(email.id)

    // 안 읽음이면 읽음으로 낙관적 전이 — 열어 봤다는 사실이다. 관리 권한이
    // 없으면(이사·감사) 애초에 PATCH가 403이므로 시도하지 않는다.
    // silent: 열어 봤을 뿐인 부수 효과라 실패해도(예: 다른 관리자가 먼저
    // 읽어서 409) 경고창을 띄우지 않는다 — 명시적 상태 변경 버튼의 실패만
    // 알린다.
    if (canManage && email.status === 'unread') {
      updateStatus(email, 'read', { silent: true })
    }
  }

  const closeDetail = () => {
    setSelectedId(null)
    setDetail(null)
    setAttachments([])
    setReplies([])
    setThread([])
    setShowRemoteImages(false)
  }

  /** 발신자 필터를 걸거나(`next`) 푼다(null). 기록을 쌓아 뒤로 가기가 이전 목록으로 돌아가게 한다. */
  const applySenderFilter = (next: SenderFilter | null) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('from')
    url.searchParams.delete('domain')
    if (next) url.searchParams.set(next.kind, next.value)
    window.history.pushState(null, '', url)
    setSenderFilter(next)
    setOffset(0)
    // 좁은 화면에서는 상세가 목록을 가리므로 닫아야 걸린 목록이 보인다.
    closeDetail()
  }

  const updateStatus = async (
    email: Pick<InboundEmail, 'id' | 'status'>,
    status: InboundEmail['status'],
    options: { silent?: boolean } = {}
  ) => {
    const expectedStatus = email.status
    setUpdating(email.id)
    try {
      const res = await fetch(`/api/admin/mailbox/${email.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, expected_status: expectedStatus }),
      })
      if (res.status === 409) {
        if (!options.silent) {
          alert('다른 관리자가 먼저 처리했습니다. 목록을 새로고침합니다.')
        }
        await fetchEmails()
        return
      }
      if (!res.ok) throw new Error('업데이트 실패')
      setEmails(prev => prev.map(e => (e.id === email.id ? { ...e, status } : e)))
      setDetail(prev => (prev && prev.id === email.id ? { ...prev, status } : prev))
    } catch {
      if (!options.silent) {
        alert('상태 업데이트에 실패했습니다.')
      }
    } finally {
      setUpdating(null)
    }
  }

  const openReply = (email: InboundEmail, all = false) => {
    setReplyTarget(email)
    setReplyBody('')
    setReplyAll(all)
    setIncludeQuote(true)
  }

  const closeReply = () => {
    if (replySending) return
    setReplyTarget(null)
    setReplyBody('')
  }

  const sendReply = async () => {
    if (!replyTarget || !replyBody.trim()) return
    setReplySending(true)
    try {
      // textarea 입력은 평문이지만 서버는 이것을 body_html로 받아 그대로
      // HTML로 발송한다(sanitizePostHtml은 태그를 정화할 뿐 개행을 <br>로
      // 바꿔주지 않는다). 여기서 이스케이프하고 개행을 <br>로 바꿔 보내지
      // 않으면 수신자는 문단이 통째로 붙은 메일을 받는다.
      const replyHtml = escapeHtml(replyBody).replace(/\n/g, '<br>')
      // 받는 사람은 보내지 않는다 — 서버가 같은 규칙(`replyRecipients`)으로 정한다. 화면은 미리 보여 줄 뿐이다.
      const res = await fetch(`/api/admin/mailbox/${replyTarget.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_html: replyHtml,
          reply_all: replyAll,
          include_quote: includeQuote && replySource?.body_text ? true : false,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // 이 저장소의 오류 응답은 { success: false, error: "<문자열>" }이다
        // (json.error가 곧 메시지 — json.error.message가 아니다).
        throw new Error(json?.error || '답장 발송에 실패했습니다.')
      }
      if (json?.data?.status === 'unknown') {
        // 요청이 Resend에 닿았는지 모른다 — 다시 보내면 같은 답장이 한 번 더 나갈 수 있다.
        setReplyTarget(null)
        setReplyBody('')
        alert(
          '답장이 나갔는지 확인할 수 없습니다. 같은 답장을 다시 보내지 말고 Resend 대시보드에서 확인해 주세요.'
        )
        return
      }
      const recorded = json?.data?.recorded ?? true
      const targetId = replyTarget.id
      setReplyTarget(null)
      setReplyBody('')
      if (recorded) {
        setEmails(prev => prev.map(e => (e.id === targetId ? { ...e, status: 'replied' } : e)))
        setDetail(prev => (prev && prev.id === targetId ? { ...prev, status: 'replied' } : prev))
        alert('답장을 보냈습니다.')
      } else {
        // 기록 실패는 같은 트랜잭션 안에서 상태 전이(updateInboundStatus)도
        // 함께 실패했을 수 있다는 뜻이다 — 낙관적으로 'replied'로 표시하면
        // 화면이 DB와 어긋날 수 있으므로 목록을 다시 읽어 실제 값을 반영한다.
        await fetchEmails()
        if (selectedId === targetId) {
          fetchDetail(targetId)
        }
        alert(
          '답장은 나갔지만 기록에 실패했습니다. 관리자에게 문의해 이 메일의 답장 기록을 확인해 주세요.'
        )
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '답장 발송에 실패했습니다.')
    } finally {
      setReplySending(false)
    }
  }

  const runSearch = () => {
    setOffset(0)
    setSearch(searchInput.trim())
  }

  const advancedCount = (hasAttachment ? 1 : 0) + (afterDate ? 1 : 0) + (beforeDate ? 1 : 0)

  const filterButtons: { key: string; label: string }[] = [
    { key: 'all', label: '전체' },
    ...STATUS_ORDER.map(s => ({ key: s, label: STATUS_LABELS[s].label })),
  ]

  const page = Math.floor(offset / LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT))
  // 대화 목록에서 연 메일은 지금 목록 페이지에 없을 수 있다 — 그때는 상세 응답을 머리글로 쓴다.
  const selectedEmail =
    emails.find(e => e.id === selectedId) ?? (detail && detail.id === selectedId ? detail : null)
  const threadInboundCount = thread.filter(item => item.kind === 'inbound').length

  // 답장 미리보기의 원본 — 헤더(`Reply-To`)·본문 평문은 상세 응답에만 있다. 답장은 상세에서 여므로 대개 있다.
  const replySource: InboundEmailDetail | null =
    replyTarget && detail && detail.id === replyTarget.id ? detail : null
  const replyPreview = replyTarget
    ? replyRecipients(
        {
          from_address: replyTarget.from_address,
          headers: replySource?.headers,
          to_addresses: replyTarget.to_addresses,
          cc_addresses: replyTarget.cc_addresses,
          received_for: replyTarget.received_for,
        },
        { all: replyAll }
      )
    : null
  // "전체 답장"이 의미 있을 때만 버튼을 그린다 — 원본이 우리에게만 왔으면 답장과 같다.
  const selectedReplyAllCount =
    selectedEmail && detail && detail.id === selectedEmail.id
      ? (replyRecipients(
          {
            from_address: detail.from_address,
            headers: detail.headers,
            to_addresses: detail.to_addresses,
            cc_addresses: detail.cc_addresses,
            received_for: detail.received_for,
          },
          { all: true }
        )?.cc.length ?? 0)
      : 0

  return (
    <div className={`flex flex-col ${className}`}>
      {/* 헤더 — 좁은 화면에서 상세를 보고 있을 때는 접어 세로를 상세 칸에
          돌려준다(브리프: 좁은 화면은 상세가 "전체 화면"이어야 한다). 별도
          상태 없이 selectedId로 판정한다. */}
      <div
        className={`${
          selectedId !== null ? 'hidden lg:flex' : 'flex'
        } flex-wrap items-center justify-between gap-3 mb-4 shrink-0`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
            <FiMail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {view === 'inbox' ? '수신 메일함' : '보낸 편지함'}
            </h2>
            <p className="text-sm text-gray-500">
              전체 {view === 'inbox' ? totalCount : sentTotal}건
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="편지함 전환"
            className="flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm"
          >
            {(
              [
                ['inbox', '받은 편지함'],
                ['sent', '보낸 편지함'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => {
                  setView(key)
                  closeDetail()
                }}
                className={`whitespace-nowrap px-3 py-2 transition-colors ${
                  view === key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {canManage && composeEnabled && (
            <button
              onClick={() => {
                setComposeTo(undefined)
                setComposeForward(undefined)
                setComposeOpen(true)
              }}
              className="flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              <FiEdit className="w-4 h-4" />새 메일
            </button>
          )}
          <button
            onClick={view === 'inbox' ? fetchEmails : () => setSentRefresh(n => n + 1)}
            className="flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm shrink-0">
          {error}
        </div>
      )}

      {view === 'sent' ? (
        <SentMailbox refreshKey={sentRefresh} onMeta={handleSentMeta} />
      ) : (
        /* 2단 본체 */
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* 목록 칸 — 좁은 화면에서는 상세가 선택되면 숨긴다 */}
          <div
            className={`${
              selectedId !== null ? 'hidden lg:flex' : 'flex'
            } flex-col w-full lg:w-1/3 lg:max-w-sm min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden`}
          >
            {/* 검색 + 필터 */}
            <div className="p-3 border-b border-gray-100 space-y-3 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') runSearch()
                  }}
                  placeholder="제목 또는 보낸 사람 검색"
                  className={inputClass}
                />
                <button
                  onClick={runSearch}
                  className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shrink-0"
                >
                  <FiSearch className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  aria-expanded={showAdvanced}
                  aria-label="상세 검색"
                  title="상세 검색"
                  className={`relative flex items-center px-3 py-2 text-sm border rounded-lg transition-colors shrink-0 ${
                    showAdvanced
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'bg-white border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <FiSliders className="w-4 h-4" />
                  {advancedCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary-600 text-white text-[10px] leading-4 text-center">
                      {advancedCount}
                    </span>
                  )}
                </button>
              </div>
              {showAdvanced && (
                <div className="space-y-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasAttachment}
                      onChange={e => {
                        setHasAttachment(e.target.checked)
                        setOffset(0)
                      }}
                      className="rounded border-gray-300"
                    />
                    첨부가 있는 메일만
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="shrink-0">받은 날</span>
                    <input
                      type="date"
                      aria-label="받은 날 시작"
                      value={afterDate}
                      max={beforeDate || undefined}
                      onChange={e => {
                        setAfterDate(e.target.value)
                        setOffset(0)
                      }}
                      className="rounded border border-gray-300 px-1.5 py-1"
                    />
                    <span>~</span>
                    <input
                      type="date"
                      aria-label="받은 날 끝"
                      value={beforeDate}
                      min={afterDate || undefined}
                      onChange={e => {
                        setBeforeDate(e.target.value)
                        setOffset(0)
                      }}
                      className="rounded border border-gray-300 px-1.5 py-1"
                    />
                  </div>
                  {advancedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setHasAttachment(false)
                        setAfterDate('')
                        setBeforeDate('')
                        setOffset(0)
                      }}
                      className="text-primary-700 hover:underline"
                    >
                      조건 지우기
                    </button>
                  )}
                </div>
              )}
              {senderFilter && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full pl-2.5 pr-1 py-1 text-xs rounded-full bg-primary-50 text-primary-800 border border-primary-200">
                    <FiUser className="w-3 h-3 shrink-0" />
                    <span className="shrink-0">
                      {senderFilter.kind === 'from' ? '보낸 사람' : '보낸 기관'}
                    </span>
                    <span className="font-medium truncate" title={senderFilter.value}>
                      {senderFilter.kind === 'domain'
                        ? `@${senderFilter.value}`
                        : senderFilter.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => applySenderFilter(null)}
                      aria-label="보낸 사람 필터 해제"
                      className="p-0.5 rounded-full hover:bg-primary-100 shrink-0"
                    >
                      <FiX className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              )}
              {senderCard && (
                <div
                  data-testid="sender-card"
                  className="rounded-lg border border-gray-200 p-2.5 text-xs text-gray-600 space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {senderCard.sender.name && (
                        <div className="font-medium text-gray-900 truncate">
                          {senderCard.sender.name}
                        </div>
                      )}
                      <div className="truncate">{senderCard.sender.email}</div>
                    </div>
                    {canManage && composeEnabled && (
                      <button
                        type="button"
                        onClick={() => {
                          setComposeTo([senderCard.sender.email])
                          setComposeForward(undefined)
                          setComposeOpen(true)
                        }}
                        className="flex items-center gap-1 shrink-0 px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
                      >
                        <FiEdit className="w-3 h-3" />
                        메일 쓰기
                      </button>
                    )}
                  </div>
                  <div>
                    받은 메일 {senderCard.sender.inbound_count}통 · 답장{' '}
                    {senderCard.sender.reply_count}통 · 보낸 메일 {senderCard.sender.sent_count}통
                  </div>
                  {senderCard.sender.first_received_at && senderCard.sender.last_received_at && (
                    <div className="text-gray-400">
                      처음 {formatDate(senderCard.sender.first_received_at)} · 최근{' '}
                      {formatDate(senderCard.sender.last_received_at)}
                    </div>
                  )}
                  <div>
                    {senderCard.member ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                        회원 {senderCard.member.display_name}
                        {senderCard.member.registration_status !== 'approved' &&
                          ` (${REGISTRATION_LABELS[senderCard.member.registration_status] ?? senderCard.member.registration_status})`}
                        {senderCard.member.registration_status === 'approved' &&
                          !senderCard.member.is_active &&
                          ' (비활성)'}
                      </span>
                    ) : (
                      <span className="text-gray-400">가입한 회원 주소가 아닙니다</span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap">
                {filterButtons.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setStatusFilter(key)
                      setOffset(0)
                    }}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                      statusFilter === key
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 목록 — 독립 스크롤 */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {loading ? (
                <div className="p-3 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : emails.length === 0 ? (
                <div className="py-16 text-center text-gray-500 text-sm">수신 메일이 없습니다.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {emails.map(email => {
                    const isSelected = selectedId === email.id
                    const statusInfo = STATUS_LABELS[email.status]
                    return (
                      <div
                        key={email.id}
                        onClick={() => selectEmail(email)}
                        className={`p-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 truncate min-w-0 text-sm">
                            {email.subject || '(제목 없음)'}
                          </span>
                          {(email.thread_count ?? 1) > 1 && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 shrink-0"
                              title="같은 대화의 메일 수"
                            >
                              대화 {email.thread_count}
                            </span>
                          )}
                          {(email.attachment_count ?? 0) > 0 && (
                            <FiPaperclip
                              className="w-3.5 h-3.5 text-gray-400 shrink-0"
                              aria-label={`첨부 ${email.attachment_count}개`}
                            />
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                          >
                            {statusInfo.label}
                          </span>
                          {email.body_fetch_status === 'pending' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              본문 받는 중
                            </span>
                          )}
                          {email.body_fetch_status === 'attachments_failed' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              첨부 받는 중
                            </span>
                          )}
                          {email.body_fetch_status === 'attachments_expired' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              첨부 일부 누락
                            </span>
                          )}
                          {email.body_fetch_status === 'failed' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              본문 없음
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 min-w-0">
                          <button
                            type="button"
                            onClick={e => {
                              // 행 클릭(메일 열기)으로 번지지 않게 한다.
                              e.stopPropagation()
                              applySenderFilter({ kind: 'from', value: senderAddress(email) })
                            }}
                            title={`${senderAddress(email)} 님이 보낸 메일만 보기`}
                            className="max-w-full truncate text-left text-xs text-gray-500 hover:text-primary-700 hover:underline"
                          >
                            {email.from_name || senderAddress(email)}
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {formatDate(email.received_at)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 페이지네이션 */}
            {!loading && totalCount > LIMIT && (
              <div className="flex items-center justify-center gap-3 py-2 border-t border-gray-100 shrink-0">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  이전
                </button>
                <span className="text-xs text-gray-500">
                  {page} / {totalPages}
                </span>
                <button
                  disabled={offset + LIMIT >= totalCount}
                  onClick={() => setOffset(offset + LIMIT)}
                  className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  다음
                </button>
              </div>
            )}
          </div>

          {/* 상세 칸 — 좁은 화면에서는 목록이 선택되지 않았으면 숨긴다 */}
          <div
            className={`${
              selectedId !== null ? 'flex' : 'hidden lg:flex'
            } flex-col flex-1 min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden`}
          >
            {selectedEmail === null ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                메일을 선택하세요
              </div>
            ) : (
              <>
                {/* 상세 헤더 — 고정 */}
                <div className="p-4 border-b border-gray-100 shrink-0">
                  <button
                    onClick={closeDetail}
                    className="lg:hidden mb-2 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <FiArrowLeft className="w-4 h-4" />
                    목록
                  </button>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3
                      className="font-semibold text-gray-900 break-words line-clamp-2"
                      title={selectedEmail.subject || '(제목 없음)'}
                    >
                      {selectedEmail.subject || '(제목 없음)'}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABELS[selectedEmail.status].color}`}
                    >
                      {STATUS_LABELS[selectedEmail.status].label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 flex flex-wrap items-baseline gap-x-1 min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        applySenderFilter({ kind: 'from', value: senderAddress(selectedEmail) })
                      }
                      title="이 사람이 보낸 메일만 보기"
                      className="text-left break-all hover:text-primary-700 hover:underline"
                    >
                      {selectedEmail.from_name ? (
                        <>
                          <span className="font-medium text-gray-700">
                            {selectedEmail.from_name}
                          </span>{' '}
                          &lt;{senderAddress(selectedEmail)}&gt;
                        </>
                      ) : (
                        senderAddress(selectedEmail)
                      )}
                    </button>
                    {senderDomain(selectedEmail) && (
                      <button
                        type="button"
                        onClick={() =>
                          applySenderFilter({
                            kind: 'domain',
                            value: senderDomain(selectedEmail) as string,
                          })
                        }
                        title="같은 기관(도메인)에서 온 메일 보기"
                        className="text-xs text-gray-400 hover:text-primary-700 hover:underline"
                      >
                        @{senderDomain(selectedEmail)} 전체
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatDate(selectedEmail.received_at)}
                  </div>
                  {attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {attachments.map(att => (
                        <a
                          key={att.id}
                          href={`/api/admin/mailbox/${selectedEmail.id}/attachments/${att.id}/download`}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <FiPaperclip className="w-3 h-3 shrink-0" />
                          {att.filename}
                          {att.size_bytes !== null && (
                            <span className="text-gray-400">({formatBytes(att.size_bytes)})</span>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                  {threadInboundCount > 1 && (
                    /* 기본은 접는다 — 펼친 채로 두면 머리글이 세로를 먹어 본문 iframe이 눌린다(답장 목록과 같은 이유). */
                    <details key={`thread-${selectedEmail.id}`} className="mt-2 text-xs">
                      <summary className="cursor-pointer text-gray-600 font-medium">
                        이 대화의 메일 {threadInboundCount}통
                        {thread.length > threadInboundCount &&
                          ` · 우리 답장 ${thread.length - threadInboundCount}통`}
                      </summary>
                      <ol className="mt-1.5 max-h-40 overflow-y-auto border-l-2 border-gray-200 pl-2 space-y-0.5">
                        {thread.map(item => {
                          const targetId = item.kind === 'inbound' ? item.id : item.email_id
                          const current = item.kind === 'inbound' && item.id === selectedEmail.id
                          return (
                            <li key={`${item.kind}-${item.id}`}>
                              <button
                                type="button"
                                disabled={current}
                                aria-current={current ? 'true' : undefined}
                                onClick={() => {
                                  const target = thread.find(
                                    t => t.kind === 'inbound' && t.id === targetId
                                  )
                                  selectEmail({
                                    id: targetId,
                                    status: target?.kind === 'inbound' ? target.status : 'read',
                                  })
                                }}
                                className={`w-full flex items-baseline gap-2 rounded px-1.5 py-1 text-left ${
                                  current
                                    ? 'bg-primary-50 text-primary-800 cursor-default'
                                    : 'text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                <span className="shrink-0 text-gray-400">
                                  {item.at ? formatDate(item.at) : ''}
                                </span>
                                <span className="truncate">
                                  {item.kind === 'inbound'
                                    ? item.from_name || item.from_email || item.from_address
                                    : '↩ 우리 답장'}
                                  {item.kind === 'inbound' && item.status === 'unread' && (
                                    <span className="ml-1 text-blue-600">●</span>
                                  )}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    </details>
                  )}
                </div>

                {/* 본문 — 남는 세로 전부를 채운다 */}
                {detailLoading ? (
                  <div className="flex-1 min-h-0 p-4">
                    <div className="h-full bg-gray-100 rounded-lg animate-pulse" />
                  </div>
                ) : detailError ? (
                  <div className="flex-1 min-h-0 p-4 text-sm text-red-600">{detailError}</div>
                ) : (
                  /*
                  받은 메일의 HTML은 외부에서 온 것이다. 화면 DOM에 직접 넣으면
                  세션을 노린 XSS 통로가 된다. 수신 본문 경로에는 서버 정화가
                  없다(`sanitizePostHtml`은 답장 발신 경로 전용) — 실제 방어는
                  sandbox 하나뿐이고, allow-scripts를 주지 않아 스크립트를 아예 못
                  돌게 하는 것으로 충분하다. allow-popups는 본문 링크를 새 탭으로
                  여는 데만 쓰이며 스크립트 실행과 무관하다 — 그것이 없으면 클릭이
                  아무 반응도 하지 않는다. 다만 sandbox는 서브리소스 로드까지 막지는
                  않으므로 buildBodySrcDoc()이 CSP 메타로 원격 이미지(추적 픽셀)를
                  추가로 막는다 — 그 메타 덕분에 인라인 이미지(html_format=data_uri로
                  base64 첨부)와 우리 출처 이미지만 보이고 그 밖의 외부 요청은
                  "이미지 표시"를 누르기 전에는 나가지 않는다.
                */
                  <>
                    {hasUntrustedRemoteImage(detail?.body_html) && (
                      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-100 shrink-0">
                        <span>
                          {showRemoteImages
                            ? '이 메일의 외부 이미지를 표시하고 있습니다. 발신자가 열람 사실을 알 수 있습니다.'
                            : '외부 이미지를 차단했습니다. 표시하면 발신자가 열람 사실을 알 수 있습니다.'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowRemoteImages(v => !v)}
                          className="shrink-0 px-2.5 py-1 rounded-md font-medium bg-white border border-amber-300 hover:bg-amber-100"
                        >
                          {showRemoteImages ? '이미지 숨기기' : '이미지 표시'}
                        </button>
                      </div>
                    )}
                    <iframe
                      title="메일 본문"
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      srcDoc={buildBodySrcDoc(detail, showRemoteImages)}
                      className="w-full flex-1 min-h-[12rem] bg-white"
                    />
                    {replies.length > 0 && (
                      /*
                        기본은 접어 둔다. 펼쳐 둔 채로 두면 이 영역이 세로를 먹어 본문 iframe이 거의 0으로 눌린다
                        (E2E가 잡았다 — 답장이 달린 메일의 본문이 안 보였다). 메일을 바꾸면 key가 달라 다시 접힌다.
                      */
                      <details
                        key={selectedEmail.id}
                        className="shrink-0 border-t border-gray-100 bg-gray-50"
                      >
                        <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-gray-600">
                          보낸 답장 {replies.length}건
                        </summary>
                        <div className="max-h-48 overflow-y-auto">
                          {replies.map(reply => (
                            <div key={reply.id} className="px-4 py-3 border-t border-gray-100">
                              <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                                <span className="truncate font-medium text-gray-700">
                                  {reply.subject}
                                </span>
                                <span className="shrink-0">
                                  {new Date(reply.created_at).toLocaleString('ko-KR')}
                                </span>
                              </div>
                              {/* 서버가 정화해 저장한 HTML이지만 수신 본문과 같은 sandbox에 가둔다. */}
                              <iframe
                                title={`보낸 답장 ${reply.subject}`}
                                sandbox="allow-popups allow-popups-to-escape-sandbox"
                                srcDoc={buildBodySrcDoc({ body_html: reply.body_html }, false)}
                                className="mt-2 w-full h-28 bg-white rounded border border-gray-100"
                              />
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}

                {/* 상태 변경 + 답장 버튼 — 관리자만. 이사·감사는 열람만 한다
                  (브리프 목표). canManage가 false면 그리지 않는다 — 숨기는
                  게 아니라 안 그린다. */}
                {canManage && (
                  <div className="flex items-center gap-2 p-3 border-t border-gray-100 flex-wrap shrink-0">
                    <span className="text-sm text-gray-500 mr-1">상태 변경:</span>
                    {STATUS_ORDER.map(s => (
                      <button
                        key={s}
                        disabled={updating === selectedEmail.id || selectedEmail.status === s}
                        onClick={() => updateStatus(selectedEmail, s)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:opacity-80 ${STATUS_LABELS[s].color}`}
                      >
                        {STATUS_LABELS[s].label}
                      </button>
                    ))}
                    <span className="flex-1" />
                    <button
                      onClick={() => openReply(selectedEmail)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors"
                    >
                      <FiSend className="w-3 h-3" />
                      답장
                    </button>
                    {composeEnabled && detail && detail.id === selectedEmail.id && (
                      <button
                        onClick={() => {
                          setComposeTo(undefined)
                          setComposeForward({
                            emailId: detail.id,
                            subject: forwardSubject(detail.subject),
                            body: buildForwardText(detail),
                            attachments: attachments.map(att => ({
                              id: att.id,
                              filename: att.filename,
                              size_bytes: att.size_bytes,
                              // 목록의 첨부 개수와 같은 규칙 — cid로 박힌 이미지는 본문 이미지다.
                              inline:
                                att.content_id !== null &&
                                (att.content_type ?? '').startsWith('image/'),
                            })),
                          })
                          setComposeOpen(true)
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        <FiSend className="w-3 h-3" />
                        전달
                      </button>
                    )}
                    {selectedReplyAllCount > 0 && (
                      <button
                        onClick={() => openReply(selectedEmail, true)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
                      >
                        <FiSend className="w-3 h-3" />
                        전체 답장
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 새 메일 작성 모달 — 관리자 + 서버 스위치가 켜졌을 때만 그린다. */}
      {canManage && composeEnabled && composeOpen && (
        <ComposeModal
          quota={composeQuota}
          initialTo={composeTo}
          forward={composeForward}
          onClose={() => {
            setComposeOpen(false)
            setComposeTo(undefined)
            setComposeForward(undefined)
          }}
          onDone={() => {
            setSentRefresh(n => n + 1)
            fetchComposeMeta()
            fetchEmails()
          }}
        />
      )}

      {/* 답장 모달 — 관리자만 그린다. */}
      {canManage && replyTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => {
            if (e.target === e.currentTarget) closeReply()
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">답장 보내기</h2>
              <button
                onClick={closeReply}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-500 space-y-1" data-testid="reply-recipients">
                <div>
                  받는 사람:{' '}
                  <span className="text-gray-900 break-all">
                    {replyPreview?.to ?? '(주소를 알 수 없음)'}
                  </span>
                  {replyPreview && replyPreview.to !== replyTarget.from_email && (
                    <span className="ml-1 text-xs text-gray-400">(회신 주소)</span>
                  )}
                </div>
                {replyAll && (
                  <div>
                    참조:{' '}
                    <span className="text-gray-900 break-all">
                      {replyPreview && replyPreview.cc.length > 0
                        ? replyPreview.cc.join(', ')
                        : '(없음)'}
                    </span>
                  </div>
                )}
                {replyAll && replyPreview && replyPreview.dropped.length > 0 && (
                  <div className="text-xs text-amber-700">
                    참조에서 뺀 주소(형식이 틀렸거나 참조 상한을 넘었습니다):{' '}
                    {replyPreview.dropped.join(', ')}
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={replyAll}
                    onChange={e => setReplyAll(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  전체 답장 (원본의 받는 사람·참조에게도 보내기, 우리 주소 제외)
                </label>
              </div>
              <div className="text-sm text-gray-500">
                제목: <span className="text-gray-900">{replySubject(replyTarget.subject)}</span>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  본문 <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={10}
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder="답장 내용을 입력하세요."
                  className={`${inputClass} resize-none`}
                />
              </div>
              {replySource?.body_text ? (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={includeQuote}
                    onChange={e => setIncludeQuote(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  원문 인용 (받은 메일의 글자만 붙입니다)
                </label>
              ) : (
                <p className="text-xs text-gray-400">
                  이 메일은 글자 본문이 없어 원문을 인용하지 않습니다.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
              <button
                onClick={closeReply}
                disabled={replySending}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={sendReply}
                disabled={replySending || !replyBody.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {replySending ? '보내는 중...' : '보내기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
