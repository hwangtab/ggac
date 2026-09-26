'use client'

/**
 * 사무국 예매 관리 — 관리자 화면이라 한국어 전용이고 next-intl을 쓰지 않는다
 * (`admin/funding/FulfillmentPanel.tsx`와 같은 규칙).
 *
 * ## 이 화면이 없으면 환불 라우트도 없는 것과 같다
 *
 * 대리 환불 API(`POST /api/admin/tickets/reservations/[id]/refund`)는 예매
 * id를 받는데, 관객은 전화로 **이름·연락처·예매번호**를 말한다. 그 둘을 잇는
 * 화면이 없으면 사무국은 DB 콘솔에서 id를 찾아야 하고, 그럴 바에는 토스
 * 콘솔에서 환불하게 된다 — 그 환불은 우리 원장에 닿지 않아 좌석이 영영
 * 잠기고 매출이 돌려준 돈을 받은 돈으로 센다. 막으려던 것이 그것이다.
 *
 * ## 실패를 "실패"라고만 적지 않는다
 *
 * 환불 라우트의 실패는 네 갈래이고 사무국이 **다음에 할 일이 갈래마다
 * 다르다** — 다시 눌러야 하는 것(503, 토스 응답 판단 불가), 눌러도 소용없는
 * 것(400, 토스 거절), 사람을 불러야 하는 것(500, 돈은 나갔는데 원장이 못
 * 따라옴). 서버가 그 문장을 만들어 보내므로 화면은 `apiErrorMessage`로 그대로
 * 옮긴다. 500은 그중 유일하게 **사라지면 안 되는** 문장이라 따로 표시한다.
 */

import { useCallback, useEffect, useState } from 'react'
import { FiRefreshCw, FiSearch, FiTag } from 'react-icons/fi'

import {
  TICKET_REFUND_REASON_MIN,
  normalizeTicketRefundReason,
} from '@/lib/payments/ticketOfficeRefund'
import {
  RESERVATION_LIST_DEFAULT_LIMIT,
  reservationRowState,
  type AdminReservationStatus,
} from '@/lib/payments/ticketReservationList'
import { apiErrorMessage } from '@/utils/apiErrorMessage'
import AdminLayout from '../components/AdminLayout'

interface ReservationRow {
  id: string
  reservation_code: string
  performance_id: string
  performance_title: string
  venue: string | null
  starts_at: string | null
  ticket_type_name: string
  booker_name: string
  booker_phone: string
  booker_email: string | null
  user_id: string | null
  quantity: number
  total_amount: number
  status: string
  payment_status: string | null
  has_payment: boolean
  refundable_amount: number
  created_at: string | null
  canceled_at: string | null
}

interface PerformanceOption {
  id: string
  title: string
  status: string
}

const STATUS_FILTERS: { key: AdminReservationStatus | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'confirmed', label: '예매 확정' },
  { key: 'pending', label: '결제 대기' },
  { key: 'canceled', label: '취소됨' },
  { key: 'expired', label: '기한 만료' },
]

const TONE_CLASS: Record<string, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  warn: 'bg-amber-100 text-amber-800',
  done: 'bg-blue-100 text-blue-800',
}

function won(n: number): string {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`
}

function formatShow(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminTicketsPage() {
  const [rows, setRows] = useState<ReservationRow[]>([])
  const [performances, setPerformances] = useState<PerformanceOption[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [performanceId, setPerformanceId] = useState('')
  const [status, setStatus] = useState<AdminReservationStatus | 'all'>('all')
  /** 실제로 서버에 건 검색어. 입력 칸(`searchDraft`)과 나누지 않으면 글자마다 조회한다. */
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 사람이 손으로 수습해야 하는 실패. 다음 조회에도 지우지 않는다. */
  const [alert, setAlert] = useState<string | null>(null)

  /** 지금 환불 칸을 펼친 예매. 한 번에 하나만 연다 — 두 줄을 동시에 적을 일이 없다. */
  const [refundOpenId, setRefundOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (performanceId) params.set('performanceId', performanceId)
      if (status !== 'all') params.set('status', status)
      if (search) params.set('q', search)
      params.set('limit', String(RESERVATION_LIST_DEFAULT_LIMIT))
      params.set('offset', String(offset))

      const res = await fetch(`/api/admin/tickets/reservations?${params}`)
      const json = await res.json()
      if (res.ok === false) throw new Error(apiErrorMessage(json, '목록을 불러오지 못했습니다.'))
      setRows((json.data?.reservations ?? []) as ReservationRow[])
      setPerformances((json.data?.performances ?? []) as PerformanceOption[])
      setTotal(Number(json.data?.total ?? 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [performanceId, status, search, offset])

  useEffect(() => {
    void load()
  }, [load])

  /** 필터를 바꾸면 첫 쪽으로 돌아간다. 3쪽에 있던 채로 필터만 바꾸면 빈 화면이 나온다. */
  function changeFilter(fn: () => void) {
    fn()
    setOffset(0)
    setRefundOpenId(null)
  }

  function openRefund(row: ReservationRow) {
    setRefundOpenId(row.id)
    setReason('')
    setAmount('')
    setError(null)
    setNotice(null)
  }

  async function submitRefund(row: ReservationRow) {
    // 서버와 같은 함수로 본다 — 최소 길이를 화면에 다시 적어 두면 서버가
    // 기준을 바꾼 날 화면만 옛 숫자로 남는다.
    const cleaned = normalizeTicketRefundReason(reason)
    if (cleaned === null) {
      setError(`환불 사유를 ${TICKET_REFUND_REASON_MIN}자 이상 적어 주세요.`)
      return
    }

    let partialAmount: number | null = null
    if (amount.trim() !== '') {
      const n = Number(amount.trim())
      if (!Number.isSafeInteger(n) || n <= 0) {
        setError('환불 금액은 1원 이상의 정수여야 합니다. 남은 전액이면 비워 두세요.')
        return
      }
      if (n > row.refundable_amount) {
        setError(`환불할 수 있는 금액은 ${won(row.refundable_amount)}까지입니다.`)
        return
      }
      partialAmount = n
    }

    const payout = partialAmount ?? row.refundable_amount
    const ok = window.confirm(
      `${row.reservation_code} (${row.booker_name}, ${row.performance_title})\n` +
        `${won(payout)}을 관객에게 돌려주고 좌석을 풉니다.\n` +
        (partialAmount === null
          ? ''
          : `남은 ${won(row.refundable_amount)} 중 일부만 돌려줍니다.\n`) +
        '이 동작은 되돌릴 수 없습니다. 계속할까요?'
    )
    if (!ok) return

    setBusyId(row.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/tickets/reservations/${row.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: cleaned,
          ...(partialAmount === null ? {} : { amount: partialAmount }),
        }),
      })
      const json = await res.json()
      if (res.ok === false) {
        const message = apiErrorMessage(json, '환불하지 못했습니다.')
        // 500은 "돈은 나갔는데 원장이 못 따라왔다"는 뜻이다 — 다음 조회에
        // 쓸려 사라지면 아무도 손대지 않은 채 남는다.
        if (res.status === 500) setAlert(message)
        else setError(message)
        // 그사이 상태가 움직였을 수 있다(409·503). 목록을 다시 읽는다.
        if (res.status === 409 || res.status === 503) await load()
        return
      }
      const refunded = Number(json?.data?.refund_amount ?? 0)
      setNotice(
        `${row.reservation_code} — ${won(refunded)}을 환불했습니다.` +
          (json?.data?.partial === true ? ' (부분 환불)' : '')
      )
      setRefundOpenId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + RESERVATION_LIST_DEFAULT_LIMIT, total)

  return (
    <AdminLayout
      title="예매 관리"
      description="예매를 찾아 확인하고, 관객이 스스로 취소할 수 없는 건을 사무국이 대신 환불합니다."
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
              <FiTag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">예매 내역</h2>
              <p className="text-sm text-gray-500">
                비회원 예매와 공연 당일 취소는 관객이 스스로 할 수 없습니다. 여기서 환불하면 돈과
                좌석과 원장이 함께 맞춰집니다 — 토스 콘솔에서 환불하면 좌석이 잠긴 채 남습니다.
              </p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={performanceId}
              onChange={e => changeFilter(() => setPerformanceId(e.target.value))}
              aria-label="공연"
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white min-w-[14rem]"
            >
              <option value="">공연 전체</option>
              {performances.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.status === 'canceled' ? ' (공연 취소)' : ''}
                </option>
              ))}
            </select>

            <form
              className="flex items-center gap-2"
              onSubmit={e => {
                e.preventDefault()
                changeFilter(() => setSearch(searchDraft.trim()))
              }}
            >
              <input
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                placeholder="예매자 이름·연락처·메일·예매번호"
                aria-label="예매 검색"
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg min-w-[18rem]"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <FiSearch className="w-4 h-4" />
                찾기
              </button>
              {search && (
                <button
                  type="button"
                  onClick={() =>
                    changeFilter(() => {
                      setSearch('')
                      setSearchDraft('')
                    })
                  }
                  className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  지우기
                </button>
              )}
            </form>
          </div>

          <div className="flex gap-2 flex-wrap">
            {STATUS_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => changeFilter(() => setStatus(key))}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  status === key
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {alert && (
          <div className="p-4 bg-red-100 border border-red-300 rounded-lg text-red-900 text-sm">
            <p className="font-semibold">사람이 확인해야 합니다</p>
            <p className="mt-1">{alert}</p>
            <button type="button" onClick={() => setAlert(null)} className="mt-2 text-xs underline">
              확인했습니다
            </button>
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-500">해당하는 예매가 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {rows.map(row => {
              const state = reservationRowState(row)
              const busy = busyId === row.id
              const open = refundOpenId === row.id

              return (
                <div
                  key={row.id}
                  className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold tracking-wider text-gray-900">
                          {row.reservation_code}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASS[state.tone]}`}
                        >
                          {state.label}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          {row.user_id ? '조합원' : '비회원'}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900">{row.performance_title}</p>
                      <p className="text-sm text-gray-600">
                        {formatShow(row.starts_at)}
                        {row.venue ? ` · ${row.venue}` : ''}
                      </p>
                      <p className="text-sm text-gray-600">
                        {row.ticket_type_name} {row.quantity}매 · {won(row.total_amount)}
                      </p>
                      <p className="text-sm text-gray-700">
                        {row.booker_name} · {row.booker_phone}
                        {row.booker_email ? ` · ${row.booker_email}` : ''}
                      </p>
                    </div>

                    <div className="text-right space-y-1">
                      <p className="text-xs text-gray-500">환불 가능 금액</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {won(row.refundable_amount)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.has_payment ? `결제 ${row.payment_status ?? '—'}` : '결제 없음'}
                      </p>
                      {state.canRefund && (
                        <button
                          type="button"
                          onClick={() => (open ? setRefundOpenId(null) : openRefund(row))}
                          className="mt-1 px-4 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                        >
                          {open ? '접기' : '환불'}
                        </button>
                      )}
                    </div>
                  </div>

                  {state.hint && (
                    <p className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                      {state.hint}
                    </p>
                  )}

                  {open && (
                    <div className="border-t border-gray-100 pt-3 space-y-3">
                      <label className="block text-sm">
                        <span className="font-medium text-gray-900">
                          환불 사유 ({TICKET_REFUND_REASON_MIN}자 이상)
                        </span>
                        <span className="block text-xs text-gray-500">
                          이 문장이 환불 기록에 그대로 남습니다.
                        </span>
                        <textarea
                          value={reason}
                          onChange={e => setReason(e.target.value)}
                          rows={2}
                          className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                          placeholder="예) 공연이 취소되어 사무국이 전액 환불함"
                        />
                      </label>

                      <label className="block text-sm">
                        <span className="font-medium text-gray-900">
                          환불 금액 (비우면 남은 전액 {won(row.refundable_amount)})
                        </span>
                        <input
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                          inputMode="numeric"
                          className="mt-1 w-48 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                          placeholder="원 단위 정수"
                        />
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitRefund(row)}
                          className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {busy ? '환불하는 중…' : '환불 실행'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setRefundOpenId(null)}
                          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              {pageStart.toLocaleString('ko-KR')}–{pageEnd.toLocaleString('ko-KR')} /{' '}
              {total.toLocaleString('ko-KR')}건
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => {
                  setRefundOpenId(null)
                  setOffset(Math.max(0, offset - RESERVATION_LIST_DEFAULT_LIMIT))
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:opacity-40"
              >
                이전
              </button>
              <button
                type="button"
                disabled={pageEnd >= total}
                onClick={() => {
                  setRefundOpenId(null)
                  setOffset(offset + RESERVATION_LIST_DEFAULT_LIMIT)
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
