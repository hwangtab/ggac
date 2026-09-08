'use client'

import { useState, useEffect, useCallback } from 'react'
import { FiMail, FiRefreshCw, FiSend, FiX, FiPaperclip, FiSearch } from 'react-icons/fi'

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
 * 발신 경로에서만 쓰인다. 실제 방어는 `sandbox=""` 하나뿐이지만 그것으로
 * 충분하다(스크립트를 아예 못 돌린다). 다만 sandbox는 서브리소스 로드는
 * 막지 않으므로, 본문에 박힌 원격 `<img>`(추적 픽셀)가 그대로 요청돼
 * 열람자의 IP와 "읽었다는 사실"을 발신자에게 알릴 수 있다. 문서 맨 앞에
 * CSP 메타로 `img-src data:`만 허용해 원격 이미지를 막는다 — 첨부로 붙은
 * 인라인 이미지는 `html_format=data_uri`로 이미 base64로 박혀 있으므로
 * 그대로 보인다.
 *
 * `body_html`이 없고 `body_text`만 있으면(순수 텍스트 메일 —
 * `body_fetch_status`는 이미 'done'이라 배지가 뜨지 않는다) 그것을
 * `<pre>`로 보여준다. HTML로 해석되면 안 되므로 반드시 이스케이프한다.
 */
const REMOTE_IMAGE_GUARD_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">'

function buildBodySrcDoc(detail: InboundEmailDetail | null): string {
  if (detail?.body_html) {
    return `${REMOTE_IMAGE_GUARD_META}${detail.body_html}`
  }
  if (detail?.body_text) {
    return `${REMOTE_IMAGE_GUARD_META}<pre style="font-family:sans-serif;white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtml(detail.body_text)}</pre>`
  }
  return `${REMOTE_IMAGE_GUARD_META}<p style="font-family:sans-serif;color:#6b7280">본문이 아직 도착하지 않았습니다.</p>`
}

/**
 * 관리자 메일함 화면의 본체 — `admin/mailbox`와 `board-room/mailbox`가
 * 공유한다(브리프 D). props 없이 자기 상태를 갖는다.
 *
 * `can_manage`(목록/상세 API 응답의 최상위 필드, `auth.isAdmin`에서 온다)가
 * false면 상태 변경 버튼·답장 버튼·답장 모달을 **렌더하지 않는다** — 숨기는
 * 게 아니라 안 그린다. 이사·감사는 열람만 하고 답장·상태 변경은 관리자만
 * 한다는 국장 결정(브리프 목표) 때문이다.
 */
export default function MailboxView() {
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

  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<InboundEmailDetail | null>(null)
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

  const toggleExpand = (email: InboundEmail) => {
    if (expanded === email.id) {
      setExpanded(null)
      setDetail(null)
      setAttachments([])
      return
    }
    setExpanded(email.id)
    setDetail(null)
    setAttachments([])
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
        if (expanded === targetId) {
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

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
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

      {/* 검색 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') runSearch()
          }}
          placeholder="제목 또는 보낸 주소 검색"
          className={`${inputClass} max-w-xs`}
        />
        <button
          onClick={runSearch}
          className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <FiSearch className="w-4 h-4" />
          검색
        </button>
      </div>

      {/* 상태 필터 */}
      <div className="flex gap-2 flex-wrap">
        {filterButtons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setStatusFilter(key)
              setOffset(0)
            }}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              statusFilter === key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 오류 */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : emails.length === 0 ? (
        <div className="py-16 text-center text-gray-500">수신 메일이 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {emails.map(email => {
            const isExpanded = expanded === email.id
            const statusInfo = STATUS_LABELS[email.status]
            return (
              <div
                key={email.id}
                className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
              >
                {/* 요약 행 */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(email)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate min-w-0">
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
                    <div className="text-sm text-gray-500 mt-0.5 truncate">
                      {email.from_address}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(email.received_at).toLocaleDateString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>

                {/* 상세 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 p-4 space-y-4">
                    {detailLoading ? (
                      <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
                    ) : detailError ? (
                      <div className="text-sm text-red-600">{detailError}</div>
                    ) : (
                      <>
                        {/*
                          받은 메일의 HTML은 외부에서 온 것이다. 화면 DOM에 직접 넣으면
                          세션을 노린 XSS 통로가 된다. 수신 본문 경로에는 서버 정화가
                          없다(`sanitizePostHtml`은 답장 발신 경로 전용) — 실제 방어는
                          sandbox="" 하나뿐이고, allow-scripts를 주지 않아 스크립트를 아예 못
                          돌게 하는 것으로 충분하다. 다만 sandbox는 서브리소스 로드까지 막지는
                          않으므로 buildBodySrcDoc()이 CSP 메타로 원격 이미지(추적 픽셀)를
                          추가로 막는다 — 그 메타 덕분에 인라인 이미지(html_format=data_uri로
                          base64 첨부)만 보이고 외부 요청은 나가지 않는다.
                        */}
                        <iframe
                          title="메일 본문"
                          sandbox=""
                          srcDoc={buildBodySrcDoc(detail)}
                          className="w-full min-h-[320px] rounded border border-gray-200 bg-white"
                        />

                        {attachments.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                              첨부파일
                            </div>
                            <ul className="space-y-1">
                              {attachments.map(att => (
                                <li key={att.id} className="flex items-center gap-2 text-sm">
                                  <FiPaperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                  <a
                                    href={`/api/admin/mailbox/${email.id}/attachments/${att.id}/download`}
                                    className="text-blue-600 hover:underline break-all"
                                  >
                                    {att.filename}
                                  </a>
                                  {att.size_bytes !== null && (
                                    <span className="text-xs text-gray-400">
                                      ({formatBytes(att.size_bytes)})
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}

                    {/* 상태 변경 + 답장 버튼 — 관리자만. 이사·감사는 열람만 한다
                        (브리프 목표). canManage가 false면 그리지 않는다 — 숨기는
                        게 아니라 안 그린다. */}
                    {canManage && (
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 flex-wrap">
                        <span className="text-sm text-gray-500 mr-1">상태 변경:</span>
                        {STATUS_ORDER.map(s => (
                          <button
                            key={s}
                            disabled={updating === email.id || email.status === s}
                            onClick={() => updateStatus(email, s)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:opacity-80 ${STATUS_LABELS[s].color}`}
                          >
                            {STATUS_LABELS[s].label}
                          </button>
                        ))}
                        <span className="flex-1" />
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            openReply(email)
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors"
                        >
                          <FiSend className="w-3 h-3" />
                          답장
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 페이지네이션 */}
      {!loading && totalCount > LIMIT && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            이전
          </button>
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            disabled={offset + LIMIT >= totalCount}
            onClick={() => setOffset(offset + LIMIT)}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            다음
          </button>
        </div>
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
