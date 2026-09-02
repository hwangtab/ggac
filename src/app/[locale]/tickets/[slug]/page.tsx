'use client'

/**
 * 공연 상세 + 예매.
 *
 * 흐름은 `회차·티켓 선택 → 예매자 정보 → 좌석 선점 → 결제창`이다. 좌석을
 * 먼저 잡는 이유는 결제부터 받으면 매진된 표를 팔고 환불해야 하기 때문이다.
 *
 * 비회원도 예매할 수 있다. 로그인 상태면 예매 내역이 마이페이지에 남는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { loadTossPayments } from '@tosspayments/tosspayments-sdk'
import { FiCalendar, FiMapPin, FiAlertCircle } from 'react-icons/fi'

interface Show {
  id: string
  starts_at: string
  capacity: number
  remaining_seats: number
  is_past: boolean
}

interface TicketType {
  id: string
  name: string
  price: number
  max_per_order: number
  members_only: boolean
}

interface PerformanceDetail {
  slug: string
  title: string
  summary: string | null
  description: string | null
  venue: string | null
  poster_image: string | null
  notice_text: string | null
  status: string
  shows: Show[]
  ticket_types: TicketType[]
}

interface Prepared {
  orderId: string
  orderName: string
  amount: number
  reservationId: string
  clientKey: string
  customerKey: string
  customerName?: string
  customerEmail?: string
}

function formatShow(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`

export default function PerformanceDetailPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug

  const [performance, setPerformance] = useState<PerformanceDetail | null>(null)
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showId, setShowId] = useState('')
  const [ticketTypeId, setTicketTypeId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [bookerName, setBookerName] = useState('')
  const [bookerPhone, setBookerPhone] = useState('')
  const [bookerEmail, setBookerEmail] = useState('')

  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const widgetsRef = useRef<unknown>(null)

  useEffect(() => {
    if (!slug) return
    void (async () => {
      try {
        const response = await fetch(`/api/tickets?slug=${encodeURIComponent(String(slug))}`)
        const result = (await response.json().catch(() => null)) as {
          data?: { performance?: PerformanceDetail; paymentEnabled?: boolean }
          error?: string
        } | null
        if (!response.ok) {
          setError(result?.error ?? '공연 정보를 불러오지 못했습니다.')
          return
        }
        const detail = result?.data?.performance ?? null
        setPerformance(detail)
        setPaymentEnabled(Boolean(result?.data?.paymentEnabled))
        // 예매 가능한 첫 회차와 첫 티켓을 기본으로 골라 둔다.
        const openShow = detail?.shows.find(s => !s.is_past && s.remaining_seats > 0)
        if (openShow) setShowId(openShow.id)
        if (detail?.ticket_types[0]) setTicketTypeId(detail.ticket_types[0].id)
      } finally {
        setLoading(false)
      }
    })()
  }, [slug])

  const selectedShow = useMemo(
    () => performance?.shows.find(s => s.id === showId) ?? null,
    [performance, showId]
  )
  const selectedType = useMemo(
    () => performance?.ticket_types.find(t => t.id === ticketTypeId) ?? null,
    [performance, ticketTypeId]
  )
  const totalAmount = (selectedType?.price ?? 0) * quantity
  const maxQuantity = Math.min(selectedType?.max_per_order ?? 1, selectedShow?.remaining_seats ?? 0)

  const startBooking = useCallback(async () => {
    setPreparing(true)
    setError(null)
    try {
      const response = await fetch('/api/tickets/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          showId,
          ticketTypeId,
          quantity,
          bookerName,
          bookerPhone,
          bookerEmail,
        }),
      })
      const result = (await response.json().catch(() => null)) as {
        data?: Prepared
        error?: string
      } | null

      if (!response.ok || !result?.data) {
        setError(result?.error ?? '예매를 준비하지 못했습니다.')
        return
      }

      const order = result.data
      setPrepared(order)

      const tossPayments = await loadTossPayments(order.clientKey)
      const widgets = tossPayments.widgets({ customerKey: order.customerKey })
      widgetsRef.current = widgets

      await widgets.setAmount({ currency: 'KRW', value: order.amount })
      await Promise.all([
        widgets.renderPaymentMethods({ selector: '#ticket-payment-method', variantKey: 'DEFAULT' }),
        widgets.renderAgreement({ selector: '#ticket-payment-agreement', variantKey: 'AGREEMENT' }),
      ])
    } catch (caught) {
      console.error('예매 준비 실패:', caught)
      setError('결제창을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPreparing(false)
    }
  }, [showId, ticketTypeId, quantity, bookerName, bookerPhone, bookerEmail])

  const requestPayment = useCallback(async () => {
    const widgets = widgetsRef.current as {
      requestPayment: (input: Record<string, unknown>) => Promise<void>
    } | null
    if (!widgets || !prepared) return

    try {
      const successUrl = new URL('/tickets/success', window.location.origin)
      successUrl.searchParams.set('reservationId', prepared.reservationId)
      await widgets.requestPayment({
        orderId: prepared.orderId,
        orderName: prepared.orderName,
        successUrl: successUrl.toString(),
        failUrl: `${window.location.origin}/tickets/fail`,
        customerName: prepared.customerName,
        customerEmail: prepared.customerEmail,
      })
    } catch (caught) {
      console.error('결제 요청 실패:', caught)
      setError('결제를 시작하지 못했습니다. 다시 시도해 주세요.')
    }
  }, [prepared])

  const canBook =
    paymentEnabled &&
    Boolean(showId && ticketTypeId && bookerName.trim() && bookerPhone.trim()) &&
    quantity >= 1 &&
    quantity <= maxQuantity &&
    totalAmount > 0

  if (loading) {
    return <div className="min-h-screen pt-40 text-center text-gray-500">불러오는 중…</div>
  }

  if (!performance) {
    return (
      <div className="min-h-screen pt-40 text-center">
        <p className="text-gray-700">{error ?? '공연을 찾을 수 없습니다.'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{performance.title}</h1>
          {performance.summary && <p className="mt-2 text-gray-600">{performance.summary}</p>}
          {performance.venue && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
              <FiMapPin className="h-4 w-4" aria-hidden />
              {performance.venue}
            </p>
          )}
        </header>

        {performance.description && (
          <section className="mb-8 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
            {performance.description}
          </section>
        )}

        {error && (
          <div className="mb-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <FiAlertCircle className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* 예매 폼 — 결제창이 열리기 전까지만 보인다 */}
        <section className={prepared ? 'hidden' : 'rounded-lg border border-gray-200 bg-white p-6'}>
          <h2 className="text-lg font-semibold text-gray-900">예매하기</h2>

          <div className="mt-5 space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-900">회차</legend>
              <div className="space-y-2">
                {performance.shows.map(show => {
                  const soldOut = show.remaining_seats === 0
                  const disabled = show.is_past || soldOut
                  return (
                    <label
                      key={show.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                        disabled
                          ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                          : showId === show.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="show"
                        value={show.id}
                        checked={showId === show.id}
                        disabled={disabled}
                        onChange={() => {
                          setShowId(show.id)
                          setQuantity(1)
                        }}
                        className="h-4 w-4"
                      />
                      <span className="flex flex-1 items-center gap-2">
                        <FiCalendar className="h-4 w-4 flex-none" aria-hidden />
                        {formatShow(show.starts_at)}
                      </span>
                      <span className="text-sm">
                        {show.is_past
                          ? '종료'
                          : soldOut
                            ? '매진'
                            : `${show.remaining_seats}석 남음`}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-900">티켓</legend>
              <div className="space-y-2">
                {performance.ticket_types.map(type => (
                  <label
                    key={type.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                      ticketTypeId === type.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ticketType"
                      value={type.id}
                      checked={ticketTypeId === type.id}
                      onChange={() => {
                        setTicketTypeId(type.id)
                        setQuantity(1)
                      }}
                      className="h-4 w-4"
                    />
                    <span className="flex-1">
                      {type.name}
                      {type.members_only && (
                        <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          조합원 전용
                        </span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">{won(type.price)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="quantity" className="mb-2 block text-sm font-medium text-gray-900">
                매수
              </label>
              <select
                id="quantity"
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                disabled={maxQuantity < 1}
                className="w-32 rounded-lg border border-gray-300 px-3 py-2"
              >
                {Array.from({ length: Math.max(0, maxQuantity) }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>
                    {n}매
                  </option>
                ))}
              </select>
              {selectedType && (
                <p className="mt-1 text-xs text-gray-500">
                  1회에 최대 {selectedType.max_per_order}매까지 예매할 수 있습니다.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="bookerName"
                  className="mb-2 block text-sm font-medium text-gray-900"
                >
                  예매자 이름
                </label>
                <input
                  id="bookerName"
                  value={bookerName}
                  onChange={e => setBookerName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  autoComplete="name"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="bookerPhone"
                  className="mb-2 block text-sm font-medium text-gray-900"
                >
                  연락처
                </label>
                <input
                  id="bookerPhone"
                  value={bookerPhone}
                  onChange={e => setBookerPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  autoComplete="tel"
                  inputMode="numeric"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="bookerEmail" className="mb-2 block text-sm font-medium text-gray-900">
                이메일 <span className="font-normal text-gray-500">(선택)</span>
              </label>
              <input
                id="bookerEmail"
                type="email"
                value={bookerEmail}
                onChange={e => setBookerEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                autoComplete="email"
              />
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 pt-5">
              <span className="text-gray-700">결제 금액</span>
              <span className="text-xl font-semibold tabular-nums text-gray-900">
                {won(totalAmount)}
              </span>
            </div>

            {!paymentEnabled && (
              <p className="text-sm text-gray-600">결제 기능을 준비하고 있습니다.</p>
            )}

            <button
              type="button"
              onClick={() => void startBooking()}
              disabled={!canBook || preparing}
              className="w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {preparing ? '결제창을 여는 중…' : '예매하고 결제하기'}
            </button>
          </div>
        </section>

        {/* 결제창 */}
        <section className={prepared ? 'block' : 'hidden'}>
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            좌석을 임시로 잡아 두었습니다. <strong>10분 안에 결제</strong>하지 않으면 좌석이
            반환됩니다.
          </div>
          <div id="ticket-payment-method" />
          <div id="ticket-payment-agreement" />
          <button
            type="button"
            onClick={() => void requestPayment()}
            className="mt-4 w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700"
          >
            {prepared ? `${won(prepared.amount)} 결제하기` : '결제하기'}
          </button>
        </section>

        {performance.notice_text && (
          <section className="mt-8 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
            <h2 className="mb-2 font-semibold text-gray-900">예매 안내</h2>
            {performance.notice_text}
          </section>
        )}
      </div>
    </div>
  )
}
