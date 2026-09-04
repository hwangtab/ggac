'use client'

/**
 * 예매 폼. 상세 화면에서 **상호작용이 필요한 부분만** 여기로 내려온다.
 *
 * 흐름은 `회차·티켓 선택 → 예매자 정보 → 좌석 선점 → 결제창`이다. 좌석을
 * 먼저 잡는 이유는 결제부터 받으면 매진된 표를 팔고 환불해야 하기 때문이다.
 *
 * 비회원도 예매할 수 있다. 로그인 상태면 예매 내역이 마이페이지에 남는다.
 */

import { loadTossPayments } from '@tosspayments/tosspayments-sdk'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiAlertCircle, FiCalendar } from 'react-icons/fi'

import { formatAmount, formatShowTime } from '../format'
import type { PerformanceDetail, Show, TicketType } from '../types'

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

interface Props {
  performance: PerformanceDetail
  paymentEnabled: boolean
  locale: string
}

export default function TicketPurchaseForm({ performance, paymentEnabled, locale }: Props) {
  const t = useTranslations('tickets')
  const price = useCallback(
    (value: number) => t('detail.priceFormat', { amount: formatAmount(value, locale) }),
    [t, locale]
  )

  // 서버가 그린 잔여 좌석은 ISR 캐시(최대 60초) 값이다. 재고는 그 사이에도
  // 변하므로 화면에 들어온 시점에 한 번 최신값으로 덮어쓴다. 초과 판매를 막는
  // 진짜 경계는 여전히 선점 트랜잭션이고, 이것은 표시를 위한 보정이다.
  const [shows, setShows] = useState<Show[]>(performance.shows)
  const ticketTypes: TicketType[] = performance.ticket_types

  const firstOpenShow = shows.find(show => !show.is_past && show.remaining_seats > 0)
  const [showId, setShowId] = useState(firstOpenShow?.id ?? '')
  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [bookerName, setBookerName] = useState('')
  const [bookerPhone, setBookerPhone] = useState('')
  const [bookerEmail, setBookerEmail] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const widgetsRef = useRef<unknown>(null)

  useEffect(() => {
    let canceled = false
    void (async () => {
      try {
        const response = await fetch(`/api/tickets?slug=${encodeURIComponent(performance.slug)}`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const result = (await response.json().catch(() => null)) as {
          data?: { performance?: { shows?: Show[] } }
        } | null
        const fresh = result?.data?.performance?.shows
        if (!canceled && Array.isArray(fresh) && fresh.length > 0) setShows(fresh)
      } catch {
        // 재고 갱신 실패는 조용히 넘긴다 — 서버가 그린 값으로도 예매는 된다.
      }
    })()
    return () => {
      canceled = true
    }
  }, [performance.slug])

  const selectedShow = useMemo(
    () => shows.find(show => show.id === showId) ?? null,
    [shows, showId]
  )
  const selectedType = useMemo(
    () => ticketTypes.find(type => type.id === ticketTypeId) ?? null,
    [ticketTypes, ticketTypeId]
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
        setError(result?.error ?? t('detail.errorPrepare'))
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
      setError(t('detail.errorWidget'))
    } finally {
      setPreparing(false)
    }
  }, [showId, ticketTypeId, quantity, bookerName, bookerPhone, bookerEmail, t])

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
      setError(t('detail.errorRequest'))
    }
  }, [prepared, t])

  const canBook =
    paymentEnabled &&
    Boolean(showId && ticketTypeId && bookerName.trim() && bookerPhone.trim()) &&
    quantity >= 1 &&
    quantity <= maxQuantity &&
    totalAmount > 0

  return (
    <>
      {error && (
        <div className="mb-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <FiAlertCircle className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* 예매 폼 — 결제창이 열리기 전까지만 보인다 */}
      <section className={prepared ? 'hidden' : 'rounded-lg border border-gray-200 bg-white p-6'}>
        <h2 className="text-lg font-semibold text-gray-900">{t('detail.bookHeading')}</h2>

        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900">
              {t('detail.showLegend')}
            </legend>
            <div className="space-y-2">
              {shows.map(show => {
                const soldOut = show.remaining_seats === 0
                const disabled = show.is_past || soldOut
                return (
                  <label
                    key={show.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 ${
                      disabled
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                        : showId === show.id
                          ? 'cursor-pointer border-primary-500 bg-primary-50'
                          : 'cursor-pointer border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="show"
                      value={show.id}
                      checked={showId === show.id}
                      disabled={disabled}
                      // disabled 입력은 보조기술이 건너뛰기도 해서, 왜 고를 수
                      // 없는지(매진·종료)를 함께 읽히도록 aria-disabled도 준다.
                      aria-disabled={disabled}
                      onChange={() => {
                        setShowId(show.id)
                        setQuantity(1)
                      }}
                      className="h-4 w-4"
                    />
                    <span className="flex flex-1 items-center gap-2">
                      <FiCalendar className="h-4 w-4 flex-none" aria-hidden />
                      {formatShowTime(show.starts_at, locale)}
                    </span>
                    <span className="text-sm">
                      {show.is_past
                        ? t('detail.showEnded')
                        : soldOut
                          ? t('detail.soldOut')
                          : t('detail.seatsLeft', { count: show.remaining_seats })}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900">
              {t('detail.ticketLegend')}
            </legend>
            <div className="space-y-2">
              {ticketTypes.map(type => (
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
                        {t('detail.membersOnly')}
                      </span>
                    )}
                  </span>
                  <span className="font-medium tabular-nums">{price(type.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="quantity" className="mb-2 block text-sm font-medium text-gray-900">
              {t('detail.quantityLabel')}
            </label>
            {maxQuantity < 1 ? (
              // 옵션이 하나도 없는 빈 드롭다운은 고장으로 보인다 — 왜 고를 수
              // 없는지 문장으로 알려준다.
              <p
                id="quantity"
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
              >
                {t('detail.noQuantity')}
              </p>
            ) : (
              <select
                id="quantity"
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                className="w-32 rounded-lg border border-gray-300 px-3 py-2"
              >
                {Array.from({ length: maxQuantity }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>
                    {t('detail.quantityOption', { count: n })}
                  </option>
                ))}
              </select>
            )}
            {selectedType && (
              <p className="mt-1 text-xs text-gray-500">
                {t('detail.maxPerOrder', { count: selectedType.max_per_order })}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bookerName" className="mb-2 block text-sm font-medium text-gray-900">
                {t('detail.bookerName')}
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
              <label htmlFor="bookerPhone" className="mb-2 block text-sm font-medium text-gray-900">
                {t('detail.bookerPhone')}
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
              {t('detail.bookerEmail')}{' '}
              <span className="font-normal text-gray-500">{t('detail.optional')}</span>
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
            <span className="text-gray-700">{t('detail.totalLabel')}</span>
            <span className="text-xl font-semibold tabular-nums text-gray-900">
              {price(totalAmount)}
            </span>
          </div>

          {!paymentEnabled && (
            <p className="text-sm text-gray-600">{t('detail.paymentPreparing')}</p>
          )}

          <button
            type="button"
            onClick={() => void startBooking()}
            disabled={!canBook || preparing}
            className="w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {preparing ? t('detail.opening') : t('detail.submit')}
          </button>
        </div>
      </section>

      {/* 결제창 */}
      <section className={prepared ? 'block' : 'hidden'}>
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t.rich('detail.holdNotice', {
            strong: chunks => <strong>{chunks}</strong>,
          })}
        </div>
        <div id="ticket-payment-method" />
        <div id="ticket-payment-agreement" />
        <button
          type="button"
          onClick={() => void requestPayment()}
          className="mt-4 w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700"
        >
          {prepared ? t('detail.payAmount', { amount: price(prepared.amount) }) : t('detail.pay')}
        </button>
      </section>
    </>
  )
}
