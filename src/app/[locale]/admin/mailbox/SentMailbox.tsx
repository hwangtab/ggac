'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FiArrowLeft, FiPaperclip, FiSearch } from 'react-icons/fi'

import { buildBodySrcDoc, formatBytes, formatDate } from './mailboxUtils'

const LIMIT = 30
/** 이 시간을 넘게 `sending`이면 함수가 발송 도중 죽은 것으로 보고 사람이 확인하게 한다. */
const STUCK_SENDING_MS = 5 * 60 * 1000

type Kind = 'all' | 'compose' | 'reply'

type SentItem = {
  id: string
  kind: 'compose' | 'reply'
  to_addresses: string
  subject: string
  status: string
  created_at: string
  related_email_id: string | null
  attachment_count: number
}

type SentDetail = {
  subject: string
  status: string
  created_at: string
  sent_at?: string | null
  error?: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  bccCount: number
  bodyHtml: string
  attachments: { id: string; filename: string; size_bytes: number | null }[]
}

const KIND_FILTERS: { key: Kind; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'compose', label: '작성한 메일' },
  { key: 'reply', label: '답장' },
]

function statusInfo(item: { status: string; created_at: string }): {
  label: string
  color: string
} {
  if (item.status === 'sending') {
    const stuck = Date.now() - new Date(item.created_at).getTime() > STUCK_SENDING_MS
    return stuck
      ? { label: '확인 필요', color: 'bg-amber-100 text-amber-800' }
      : { label: '발송 중', color: 'bg-yellow-100 text-yellow-800' }
  }
  switch (item.status) {
    case 'sent':
      return { label: '보냄', color: 'bg-green-100 text-green-800' }
    case 'failed':
      return { label: '실패', color: 'bg-red-100 text-red-800' }
    case 'unknown':
      return { label: '확인 필요', color: 'bg-amber-100 text-amber-800' }
    case 'blocked':
      return { label: '한도로 차단', color: 'bg-red-100 text-red-800' }
    default:
      return { label: item.status, color: 'bg-gray-100 text-gray-700' }
  }
}

function parseAddresses(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function recipientSummary(raw: string): string {
  const list = parseAddresses(raw)
  if (list.length === 0) return ''
  return list.length === 1 ? list[0] : `${list[0]} 외 ${list.length - 1}명`
}

/**
 * 보낸 편지함 — 새로 작성한 메일과 받은 메일에 보낸 답장을 한 목록으로 본다.
 *
 * 이사·감사도 열람한다. 숨은참조 주소는 서버가 관리자에게만 내려보내므로(`bcc_addresses`) 이사·감사에게는
 * 개수만 보인다. 상태 변경·삭제는 없다 — 보낸 메일은 원장이다.
 */
export default function SentMailbox({
  refreshKey,
  onMeta,
}: {
  /** 값이 바뀌면 목록을 다시 읽는다(작성 직후). */
  refreshKey: number
  onMeta: (meta: { total: number }) => void
}) {
  const [kind, setKind] = useState<Kind>('all')
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [items, setItems] = useState<SentItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<SentItem | null>(null)
  const [detail, setDetail] = useState<SentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [resolving, setResolving] = useState(false)

  // 응답이 요청 순서대로 오지 않을 수 있다(A→B를 빠르게 누르면 A가 늦게 도착한다). 가장 최근 요청의
  // 응답만 화면에 반영한다.
  const listSeq = useRef(0)
  const detailSeq = useRef(0)

  const fetchList = useCallback(async () => {
    const seq = ++listSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        kind,
        limit: String(LIMIT),
        offset: String(offset),
      })
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/mailbox/outbound?${params}`)
      if (!res.ok) throw new Error('보낸 편지함을 불러오지 못했습니다.')
      const json = await res.json()
      if (seq !== listSeq.current) return
      setItems(json.data?.items ?? [])
      setTotal(json.data?.total_count ?? 0)
      onMeta({ total: json.data?.total_count ?? 0 })
    } catch (err) {
      if (seq !== listSeq.current) return
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      if (seq === listSeq.current) setLoading(false)
    }
  }, [kind, offset, search, onMeta])

  useEffect(() => {
    fetchList()
    // refreshKey가 바뀔 때마다 다시 읽는다.
  }, [fetchList, refreshKey])

  const open = async (item: SentItem) => {
    const seq = ++detailSeq.current
    setSelected(item)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      if (item.kind === 'compose') {
        const res = await fetch(`/api/admin/mailbox/outbound/${item.id}`)
        if (!res.ok) throw new Error('상세를 불러오지 못했습니다.')
        const { data } = await res.json()
        if (seq !== detailSeq.current) return
        const email = data?.email ?? {}
        setCanManage(data?.can_manage === true)
        setDetail({
          subject: email.subject,
          status: email.status,
          created_at: email.created_at,
          sent_at: email.sent_at,
          error: email.error,
          to: email.to_addresses ?? [],
          cc: email.cc_addresses ?? [],
          bcc: email.bcc_addresses ?? [],
          bccCount: email.bcc_count ?? 0,
          bodyHtml: email.body_html ?? '',
          attachments: data?.attachments ?? [],
        })
      } else {
        // 답장은 원본 받은 메일의 replies에 본문이 있다.
        const res = await fetch(`/api/admin/mailbox/${item.related_email_id}`)
        if (!res.ok) throw new Error('상세를 불러오지 못했습니다.')
        const { data } = await res.json()
        if (seq !== detailSeq.current) return
        const reply = (data?.replies ?? []).find((r: { id: string }) => r.id === item.id)
        if (!reply) throw new Error('답장을 찾을 수 없습니다.')
        setDetail({
          subject: reply.subject,
          status: 'sent',
          created_at: reply.created_at,
          // 받는 사람·참조는 답장 행에 기록돼 있다(0039). 그 전 답장은 원본 발신자에게만 갔다.
          to: [reply.to_address ?? data?.email?.from_address].filter(Boolean),
          cc: reply.cc_addresses ? parseAddresses(reply.cc_addresses) : [],
          bcc: [],
          bccCount: 0,
          bodyHtml: reply.body_html,
          attachments: [],
        })
      }
    } catch (err) {
      if (seq !== detailSeq.current) return
      setDetailError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false)
    }
  }

  // 운영자가 Resend 대시보드로 확인한 결과로 멈춘 행을 확정한다. 메일을 다시 보내지 않는다 — 장부만 바꾼다.
  const resolve = async (next: 'sent' | 'failed') => {
    if (!selected || resolving) return
    const message =
      next === 'sent'
        ? 'Resend 대시보드에서 이 메일이 실제로 나간 것을 확인하셨나요? "나갔음"으로 표시합니다.'
        : 'Resend 대시보드에서 이 메일이 나가지 않은 것을 확인하셨나요? "안 나갔음"으로 표시하면 오늘 한도에서 빠집니다.'
    if (!window.confirm(message)) return
    setResolving(true)
    try {
      const res = await fetch(`/api/admin/mailbox/outbound/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '상태를 바꾸지 못했습니다.')
      await fetchList()
      await open({ ...selected, status: next })
    } catch (err) {
      alert(err instanceof Error ? err.message : '상태를 바꾸지 못했습니다.')
    } finally {
      setResolving(false)
    }
  }

  const runSearch = () => {
    setOffset(0)
    setSelected(null)
    setDetail(null)
    setSearch(searchInput.trim())
  }

  const page = Math.floor(offset / LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const detailStatus = detail
    ? statusInfo({ status: detail.status, created_at: detail.created_at })
    : null

  return (
    <>
      {error && (
        <div className="mb-4 shrink-0 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
        {/* 목록 */}
        <div
          className={`${
            selected ? 'hidden lg:flex' : 'flex'
          } min-h-0 w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white lg:w-1/3 lg:max-w-sm`}
        >
          <div className="shrink-0 space-y-3 border-b border-gray-100 p-3">
            {/* 제목·받는 사람·참조만 검색한다. 숨은참조는 검색되지 않는다. */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') runSearch()
                }}
                placeholder="제목 또는 받는 주소 검색"
                aria-label="보낸 메일 검색"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="button"
                onClick={runSearch}
                aria-label="검색"
                className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-colors hover:bg-gray-50"
              >
                <FiSearch className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {KIND_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    setKind(key)
                    setOffset(0)
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    kind === key
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">
                {search ? '검색 결과가 없습니다.' : '보낸 메일이 없습니다.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {items.map(item => {
                  const info = statusInfo(item)
                  return (
                    <div
                      key={`${item.kind}-${item.id}`}
                      onClick={() => open(item)}
                      className={`cursor-pointer p-3 transition-colors ${
                        selected?.id === item.id ? 'bg-primary-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                          {item.subject || '(제목 없음)'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.color}`}
                        >
                          {info.label}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {item.kind === 'reply' ? '답장' : '작성'}
                        </span>
                        {item.attachment_count > 0 && (
                          <FiPaperclip className="h-3 w-3 text-gray-400" aria-label="첨부 있음" />
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-gray-500">
                        받는 사람: {recipientSummary(item.to_addresses)}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {formatDate(item.created_at)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {!loading && total > LIMIT && (
            <div className="flex shrink-0 items-center justify-center gap-3 border-t border-gray-100 py-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                이전
              </button>
              <span className="text-xs text-gray-500">
                {page} / {totalPages}
              </span>
              <button
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset(offset + LIMIT)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                다음
              </button>
            </div>
          )}
        </div>

        {/* 상세 */}
        <div
          className={`${
            selected ? 'flex' : 'hidden lg:flex'
          } min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white`}
        >
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              메일을 선택하세요
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-gray-100 p-4">
                <button
                  onClick={() => {
                    setSelected(null)
                    setDetail(null)
                  }}
                  className="mb-2 flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-700 lg:hidden"
                >
                  <FiArrowLeft className="h-4 w-4" />
                  목록
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="line-clamp-2 break-words font-semibold text-gray-900">
                    {detail?.subject ?? selected.subject}
                  </h3>
                  {detailStatus && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${detailStatus.color}`}
                    >
                      {detailStatus.label}
                    </span>
                  )}
                </div>
                {detail && (
                  <div className="mt-2 space-y-0.5 text-sm text-gray-500">
                    <div>받는 사람: {detail.to.join(', ')}</div>
                    {detail.cc.length > 0 && <div>참조: {detail.cc.join(', ')}</div>}
                    {detail.bcc.length > 0 ? (
                      <div>숨은참조: {detail.bcc.join(', ')}</div>
                    ) : (
                      detail.bccCount > 0 && <div>숨은참조: {detail.bccCount}명</div>
                    )}
                    <div className="text-xs text-gray-400">{formatDate(detail.created_at)}</div>
                    {detail.error && detail.status !== 'sent' && (
                      <div className="text-xs text-red-600">{detail.error}</div>
                    )}
                    {(detail.status === 'unknown' ||
                      (detail.status === 'sending' && detailStatus?.label === '확인 필요')) && (
                      <div className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">
                        발송 여부를 확인하지 못했습니다. 다시 보내지 말고 Resend 대시보드에서 확인해
                        주세요.
                        {canManage && selected.kind === 'compose' && (
                          <span className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={resolving}
                              onClick={() => resolve('sent')}
                              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100 disabled:opacity-50"
                            >
                              나갔음으로 표시
                            </button>
                            <button
                              type="button"
                              disabled={resolving}
                              onClick={() => resolve('failed')}
                              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100 disabled:opacity-50"
                            >
                              안 나갔음으로 표시
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {detail && detail.attachments.length > 0 && selected.kind === 'compose' && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {detail.attachments.map(att => (
                      <a
                        key={att.id}
                        href={`/api/admin/mailbox/outbound/${selected.id}/attachments/${att.id}/download`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        <FiPaperclip className="h-3 w-3 shrink-0" />
                        {att.filename}
                        {att.size_bytes !== null && (
                          <span className="text-gray-400">({formatBytes(att.size_bytes)})</span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {detailLoading ? (
                <div className="min-h-0 flex-1 p-4">
                  <div className="h-full animate-pulse rounded-lg bg-gray-100" />
                </div>
              ) : detailError ? (
                <div className="min-h-0 flex-1 p-4 text-sm text-red-600">{detailError}</div>
              ) : (
                /* 서버가 정화해 저장한 HTML이지만 받은 메일과 같은 sandbox + CSP 메타에 가둔다. */
                <iframe
                  title="보낸 메일 본문"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={buildBodySrcDoc({ body_html: detail?.bodyHtml ?? '' }, false)}
                  className="min-h-0 w-full flex-1 bg-white"
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
