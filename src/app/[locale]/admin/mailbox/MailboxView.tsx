'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FiMail,
  FiRefreshCw,
  FiSend,
  FiX,
  FiPaperclip,
  FiSearch,
  FiArrowLeft,
} from 'react-icons/fi'

interface InboundEmail {
  id: string
  resend_email_id: string
  message_id: string | null
  from_address: string
  to_addresses: string
  cc_addresses: string
  received_for: string
  subject: string | null
  status: 'unread' | 'read' | 'replied' | 'archived' | 'spam'
  body_fetch_status: 'pending' | 'done' | 'failed'
  thread_references: string | null
  received_at: string
  created_at: string
  updated_at: string
}

interface InboundEmailDetail extends InboundEmail {
  body_html: string | null
  body_text: string | null
  headers: string | null
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

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 받은 메일 본문을 iframe에 넣을 srcDoc을 만든다.
 *
 * 수신 본문 경로에는 정화(sanitize)가 없다 — `sanitizePostHtml`은 답장
 * 발신 경로에서만 쓰인다. 실제 방어는 sandbox 하나뿐이지만 그것으로
 * 충분하다 — `allow-scripts`를 주지 않아 스크립트를 아예 못 돌린다
 * (`allow-popups`는 새 탭을 여는 것만 허용할 뿐 실행 권한이 아니다).
 * 다만 sandbox는 서브리소스 로드는
 * 막지 않으므로, 본문에 박힌 원격 `<img>`(추적 픽셀)가 그대로 요청돼
 * 열람자의 IP와 "읽었다는 사실"을 발신자에게 알릴 수 있다. 문서 맨 앞에
 * CSP 메타로 `img-src`를 `data:` + **우리 출처**(ggac.kr, 공개 Blob,
 * YouTube 썸네일)로 한정해 그 밖의 원격 이미지를 막는다 — 첨부로 붙은
 * 인라인 이미지는 `html_format=data_uri`로 이미 base64로 박혀 있으므로
 * 그대로 보이고, 우리가 보낸 메일이 인용돼 돌아온 경우(프레스킷 아트워크·
 * 앨범 썸네일)도 깨지지 않는다. 그 외 출처는 관리자가 메일별로
 * "이미지 표시"를 눌렀을 때만(`showRemoteImages`) `https:` 전체로 연다 —
 * 발신자에게 열람 사실을 알리는 것은 그때뿐이다.
 *
 * `body_html`이 없고 `body_text`만 있으면(순수 텍스트 메일 —
 * `body_fetch_status`는 이미 'done'이라 배지가 뜨지 않는다) 그것을
 * `<pre>`로 보여준다. HTML로 해석되면 안 되므로 반드시 이스케이프한다.
 *
 * 본문 문서는 관리자 화면의 다크 테마와 무관하게 **항상 밝은 바탕**이다.
 * 메일 HTML은 대개 `<body>`도 배경 지정도 없이 검은 글씨만 전제하므로,
 * iframe 문서가 부모의 `color-scheme: dark`를 물려받으면 검정 위에 검정이
 * 된다(2026-09-09 실제 메일로 확인). `color-scheme` 메타와 인라인 스타일로
 * 고정한다 — 둘 다 위 CSP(`style-src 'unsafe-inline'`)가 허용한다.
 */
const TRUSTED_IMAGE_ORIGINS = [
  'https://ggac.kr',
  'https://www.ggac.kr',
  'https://img.youtube.com',
  'https://i.ytimg.com',
  // NEXT_PUBLIC_ 접두사라 빌드 시 클라이언트 번들에 박힌다. 비어 있으면 빠진다.
  (process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
]
  .filter(origin => /^https:\/\/[^\s'";]+$/.test(origin))
  .join(' ')

function remoteImageGuardMeta(showRemoteImages: boolean): string {
  const imgSrc = showRemoteImages ? 'data: https:' : `data: ${TRUSTED_IMAGE_ORIGINS}`
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'">`
}

/** 본문에 우리 출처가 아닌 원격 이미지가 있는가 — "이미지 표시" 버튼을 띄울지 판정. */
function hasUntrustedRemoteImage(bodyHtml: string | null | undefined): boolean {
  if (!bodyHtml) return false
  const trusted = TRUSTED_IMAGE_ORIGINS.split(' ')
  for (const match of bodyHtml.matchAll(
    /<img\b[^>]*?\ssrc\s*=\s*["']?\s*(https?:\/\/[^"'\s>]+)/gi
  )) {
    let origin: string
    try {
      origin = new URL(match[1]).origin
    } catch {
      return true
    }
    if (!trusted.includes(origin)) return true
  }
  return false
}
const LIGHT_CANVAS =
  '<meta name="color-scheme" content="light only">' +
  '<style>html,body{background:#fff;color:#111827;margin:0;padding:8px}</style>'

/**
 * 본문 안의 링크는 **새 탭**으로 연다.
 *
 * iframe은 `sandbox`에 `allow-popups`만 더해 두었다(스크립트는 여전히 금지).
 * 그래서 iframe 자신을 이동시키는 링크는 막히고 새 창만 열리므로, 모든
 * 앵커에 `target="_blank"`가 붙어 있어야 클릭이 먹는다. 메일 HTML은 target을
 * 안 붙이는 경우가 많아 `<base>`로 기본값을 준다.
 *
 * `rel`은 `<base>`로 줄 수 없어 앵커마다 직접 박는다. `noopener`가 없으면
 * 열린 페이지가 `window.opener`로 본문 프레임을 다른 주소로 바꿔치기할 수
 * 있고(역탭내빙), `noreferrer`는 어느 메일을 열었는지가 참조 주소로 새어
 * 나가는 것을 막는다. 발신자가 `rel="nofollow"` 같은 값을 이미 붙여 둔
 * 앵커는 **건너뛰지 않고 그 값에 덧붙인다** — 건너뛰면 메일 쪽에서 rel을
 * 하나 넣는 것만으로 보호를 벗겨낼 수 있다.
 */
const LINK_TARGET_BASE = '<base target="_blank">'

function hardenLinks(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (tag, attrs: string) => {
    const relPattern = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    const found = attrs.match(relPattern)
    if (!found) return `<a${attrs} rel="noopener noreferrer">`
    const existing = (found[1] ?? found[2] ?? found[3] ?? '').trim()
    const merged = [
      ...new Set([...existing.split(/\s+/).filter(Boolean), 'noopener', 'noreferrer']),
    ]
    return `<a${attrs.replace(relPattern, '')} rel="${merged.join(' ')}">`
  })
}
function buildBodySrcDoc(
  detail: InboundEmailDetail | null,
  showRemoteImages: boolean = false
): string {
  const BODY_DOC_HEAD = remoteImageGuardMeta(showRemoteImages) + LIGHT_CANVAS + LINK_TARGET_BASE
  if (detail?.body_html) {
    return `${BODY_DOC_HEAD}${hardenLinks(detail.body_html)}`
  }
  if (detail?.body_text) {
    return `${BODY_DOC_HEAD}<pre style="font-family:sans-serif;white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtml(detail.body_text)}</pre>`
  }
  return `${BODY_DOC_HEAD}<p style="font-family:sans-serif;color:#6b7280">본문이 아직 도착하지 않았습니다.</p>`
}

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

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InboundEmailDetail | null>(null)
  // 메일별로 켜고, 다른 메일을 고르면 다시 꺼진다 — 한 번의 허용이 다음
  // 메일의 추적 픽셀까지 열어 주면 안 된다.
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [replyTarget, setReplyTarget] = useState<InboundEmail | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [replySending, setReplySending] = useState(false)

  const fetchEmails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('search', search)
      params.set('limit', String(LIMIT))
      params.set('offset', String(offset))

      const res = await fetch(`/api/admin/mailbox?${params}`)
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
  }, [statusFilter, search, offset])

  useEffect(() => {
    fetchEmails()
  }, [fetchEmails])

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const res = await fetch(`/api/admin/mailbox/${id}`)
      if (!res.ok) throw new Error('상세를 불러오지 못했습니다.')
      const json = await res.json()
      setDetail(json.data?.email ?? null)
      setAttachments(json.data?.attachments ?? [])
      setCanManage(json.data?.can_manage === true)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const selectEmail = (email: InboundEmail) => {
    setSelectedId(email.id)
    setDetail(null)
    setAttachments([])
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
    setShowRemoteImages(false)
  }

  const updateStatus = async (
    email: InboundEmail,
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

  const openReply = (email: InboundEmail) => {
    setReplyTarget(email)
    setReplyBody('')
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
      const res = await fetch(`/api/admin/mailbox/${replyTarget.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body_html: replyHtml }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // 이 저장소의 오류 응답은 { success: false, error: "<문자열>" }이다
        // (json.error가 곧 메시지 — json.error.message가 아니다).
        throw new Error(json?.error || '답장 발송에 실패했습니다.')
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

  const filterButtons: { key: string; label: string }[] = [
    { key: 'all', label: '전체' },
    ...STATUS_ORDER.map(s => ({ key: s, label: STATUS_LABELS[s].label })),
  ]

  const page = Math.floor(offset / LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT))
  const selectedEmail = emails.find(e => e.id === selectedId) ?? null

  return (
    <div className={`flex flex-col ${className}`}>
      {/* 헤더 — 좁은 화면에서 상세를 보고 있을 때는 접어 세로를 상세 칸에
          돌려준다(브리프: 좁은 화면은 상세가 "전체 화면"이어야 한다). 별도
          상태 없이 selectedId로 판정한다. */}
      <div
        className={`${
          selectedId !== null ? 'hidden lg:flex' : 'flex'
        } items-center justify-between mb-4 shrink-0`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
            <FiMail className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">수신 메일함</h2>
            <p className="text-sm text-gray-500">전체 {totalCount}건</p>
          </div>
        </div>
        <button
          onClick={fetchEmails}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      {error && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* 2단 본체 */}
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
                placeholder="제목 또는 보낸 주소 검색"
                className={inputClass}
              />
              <button
                onClick={runSearch}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shrink-0"
              >
                <FiSearch className="w-4 h-4" />
              </button>
            </div>
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
                        {email.body_fetch_status === 'failed' && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            본문 없음
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {email.from_address}
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
                <div className="text-sm text-gray-500 mt-1">{selectedEmail.from_address}</div>
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
                    className="w-full flex-1 min-h-0 bg-white"
                  />
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
                </div>
              )}
            </>
          )}
        </div>
      </div>

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
              <div className="text-sm text-gray-500">
                받는 사람: <span className="text-gray-900">{replyTarget.from_address}</span>
              </div>
              <div className="text-sm text-gray-500">
                제목:{' '}
                <span className="text-gray-900">
                  {(replyTarget.subject || '(제목 없음)').startsWith('Re: ')
                    ? replyTarget.subject
                    : `Re: ${replyTarget.subject || '(제목 없음)'}`}
                </span>
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
