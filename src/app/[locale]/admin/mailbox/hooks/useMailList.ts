import { useState, useEffect, useCallback, useRef } from 'react'

import {
  LIMIT,
  readSenderFilterFromUrl,
  type InboundEmail,
  type SenderCard,
  type SenderFilter,
} from '../mailboxTypes'

/**
 * 목록 칸의 상태 — 거르기·페이지·검색·목록 읽기·고른 메일. 목록 읽기는 순번 + AbortController로 마지막 요청만 반영한다.
 */
export function useMailList() {
  const [emails, setEmails] = useState<InboundEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  // 일괄 처리(관리자만) — 지금 목록 페이지에서 고른 메일. 목록이 바뀌면 페이지에 없는 id는 버린다.
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  // "내 담당" — 지금 로그인한 사람이 담당자인 메일만. 이사·감사도 쓴다.
  const [mineOnly, setMineOnly] = useState(false)
  // "다시 알림" 보기 — 다시 알림을 건 메일만. 기본 목록에서는 숨긴다(검색·거르기 중에는 서버가 함께 준다).
  const [snoozedOnly, setSnoozedOnly] = useState(false)
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
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

  // 목록 요청 경합 방지: 필터·페이지를 빠르게 바꿀 때 늦게 도착한 옛 응답이 새 목록을 덮어쓰지 못하게
  // 가장 마지막 요청만 상태를 바꾼다(순번 + AbortController).
  const listReqRef = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)

  const fetchEmails = useCallback(async () => {
    const seq = ++listReqRef.current
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
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
      if (mineOnly) params.set('assignee', 'me')
      if (labelFilter) params.set('label', labelFilter)
      if (snoozedOnly) params.set('snoozed', 'only')
      params.set('limit', String(LIMIT))
      params.set('offset', String(offset))

      const res = await fetch(`/api/admin/mailbox?${params}`, { signal: controller.signal })
      if (seq !== listReqRef.current) return
      if (res.status === 400) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || '검색 조건이 올바르지 않습니다.')
      }
      if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.')
      const json = await res.json()
      if (seq !== listReqRef.current) return
      setEmails(json.data?.emails ?? [])
      setTotalCount(json.data?.pagination?.total_count ?? 0)
      setCanManage(json.data?.can_manage === true)
    } catch (err) {
      if (seq !== listReqRef.current || (err as Error)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      if (seq === listReqRef.current) setLoading(false)
    }
  }, [
    statusFilter,
    search,
    offset,
    senderFilter,
    hasAttachment,
    afterDate,
    beforeDate,
    mineOnly,
    labelFilter,
    snoozedOnly,
  ])

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

  // 목록이 바뀌면(필터·페이지·새로고침) 화면에 없는 메일은 고른 목록에서 뺀다 — 보이지 않는 메일이 함께 바뀌지 않게.
  useEffect(() => {
    setCheckedIds(prev => prev.filter(id => emails.some(e => e.id === id)))
  }, [emails])

  const toggleChecked = useCallback(
    (id: string) =>
      setCheckedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])),
    []
  )

  const runSearch = () => {
    setOffset(0)
    setSearch(searchInput.trim())
  }

  const changeStatusFilter = (key: string) => {
    setStatusFilter(key)
    setOffset(0)
  }

  const toggleMineOnly = () => {
    setMineOnly(v => !v)
    setOffset(0)
  }

  const toggleSnoozedOnly = () => {
    setSnoozedOnly(v => !v)
    setOffset(0)
  }

  const toggleLabelFilter = (labelId: string) => {
    setLabelFilter(current => (current === labelId ? null : labelId))
    setOffset(0)
  }

  const changeAdvanced = (patch: {
    hasAttachment?: boolean
    afterDate?: string
    beforeDate?: string
  }) => {
    if (patch.hasAttachment !== undefined) setHasAttachment(patch.hasAttachment)
    if (patch.afterDate !== undefined) setAfterDate(patch.afterDate)
    if (patch.beforeDate !== undefined) setBeforeDate(patch.beforeDate)
    setOffset(0)
  }

  /** 발신자 필터를 걸거나(`next`) 푼다(null). 기록을 쌓아 뒤로 가기가 이전 목록으로 돌아가게 한다. */
  const setSenderFilterWithHistory = (next: SenderFilter | null) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('from')
    url.searchParams.delete('domain')
    if (next) url.searchParams.set(next.kind, next.value)
    window.history.pushState(null, '', url)
    setSenderFilter(next)
    setOffset(0)
  }

  return {
    emails,
    setEmails,
    loading,
    error,
    statusFilter,
    changeStatusFilter,
    searchInput,
    setSearchInput,
    runSearch,
    totalCount,
    offset,
    setOffset,
    checkedIds,
    setCheckedIds,
    toggleChecked,
    mineOnly,
    toggleMineOnly,
    snoozedOnly,
    toggleSnoozedOnly,
    labelFilter,
    setLabelFilter,
    toggleLabelFilter,
    canManage,
    setCanManage,
    senderFilter,
    setSenderFilterWithHistory,
    senderCard,
    showAdvanced,
    setShowAdvanced,
    hasAttachment,
    afterDate,
    beforeDate,
    changeAdvanced,
    fetchEmails,
  }
}

export type MailList = ReturnType<typeof useMailList>
