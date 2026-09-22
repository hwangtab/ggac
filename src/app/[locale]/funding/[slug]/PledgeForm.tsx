'use client'

/**
 * 후원 폼. 상세 화면에서 **상호작용이 필요한 부분만** 여기로 내려온다.
 *
 * 흐름은 `리워드 선택 → 후원자 정보 → 수량 선점 → 결제창`이다. 수량을 먼저
 * 잡는 이유는 결제부터 받으면 매진된 리워드를 팔고 환불해야 하기 때문이다.
 *
 * 비회원도 후원할 수 있다. 로그인 상태면 후원 내역이 마이페이지에 남는다.
 *
 * 약관은 **체크박스가 아니라 고지**다. 전자상거래법 제13조는 고지를 요구하지
 * 동의 체크를 요구하지 않고, 토스 위젯이 자기 필수 동의를 바로 아래 그린다 —
 * 두 개가 겹치면 어느 쪽을 눌러야 하는지 헷갈린다. 요청에는 동의 플래그를
 * 그대로 실어 "이 고지를 보고 눌렀다"를 서버 원장에 남긴다.
 */

import { loadTossPayments } from '@tosspayments/tosspayments-sdk'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'
import { ADDITIONAL_AMOUNT_STEP, MAX_ADDITIONAL_AMOUNT, MAX_QUANTITY } from '@/lib/funding/amounts'

import { formatAmount } from '../format'
import type { CampaignDetail, Reward } from '../types'

interface Prepared {
  orderId: string
  orderName: string
  amount: number
  pledgeId: string
  pledgeCode: string
  clientKey: string
  customerKey: string
  customerName?: string
  customerEmail?: string
}

interface Props {
  campaign: CampaignDetail
  paymentEnabled: boolean
  locale: string
}

export default function PledgeForm({ campaign, paymentEnabled, locale }: Props) {
  const t = useTranslations('funding')
  const price = useCallback(
    (value: number) => t('reward.amount', { amount: formatAmount(value, locale) }),
    [t, locale]
  )
  const [rewardId, setRewardId] = useState<string>('')
  const [quantity, setQuantity] = useState(1)
  const [additionalText, setAdditionalText] = useState('')
  const [backerName, setBackerName] = useState('')
  const [backerEmail, setBackerEmail] = useState('')
  const [backerPhone, setBackerPhone] = useState('')
  const [shipping, setShipping] = useState({
    name: '',
    phone: '',
    postcode: '',
    address1: '',
    address2: '',
    memo: '',
  })
  const [message, setMessage] = useState('')
  const [messagePublic, setMessagePublic] = useState(false)
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  // 서버가 선점(reservation)을 돌려주는 순간 여기 세운다 — 위젯 로드는
  // 별개 단계다. 위젯이 실패해도 이 값은 남아 있어야, 다시 눌렀을 때 새
  // 선점을 또 만들지 않고 같은 선점으로 위젯만 다시 연다(아래 `retryWidget`).
  const [reservation, setReservation] = useState<Prepared | null>(null)
  // 결제창(위젯)이 실제로 뜬 상태인가. `reservation`과 분리해 둬야 "선점은
  // 됐는데 위젯만 실패"한 상태를 표현할 수 있다.
  const [widgetReady, setWidgetReady] = useState(false)
  const widgetsRef = useRef<unknown>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)

  // 상세 페이지는 60초 ISR로 캐시된다 — 그 사이 남은 수량이 달라질 수 있다.
  // 화면에 들어온 시점에 가벼운 상태 엔드포인트로 한 번 최신값을 덮어쓴다.
  // 초과 판매를 막는 진짜 경계는 여전히 선점 트랜잭션이고, 이건 사람이 5분을
  // 들여 정보를 다 채운 뒤에야 매진을 알게 되는 낭비를 줄이기 위한 보정이다.
  const [rewards, setRewards] = useState<Reward[]>(campaign.rewards)
  // 갱신이 끝나는 시점의 최신 선택값을 보려면 ref가 필요하다 — 이 effect는
  // 마운트 시 한 번만 걸리므로 클로저 안의 `rewardId`는 갱신되지 않는다.
  const rewardIdRef = useRef(rewardId)
  useEffect(() => {
    rewardIdRef.current = rewardId
  }, [rewardId])
  useEffect(() => {
    let canceled = false
    void (async () => {
      try {
        const response = await fetch(
          `/api/funding/campaigns/${encodeURIComponent(campaign.slug)}/status`,
          { cache: 'no-store' }
        )
        if (!response.ok) return
        const result = (await response.json().catch(() => null)) as {
          data?: { stock?: Record<string, number | null> }
        } | null
        const stock = result?.data?.stock
        if (canceled || !stock || typeof stock !== 'object') return
        // 남은 수량이 이미 고른 수량보다 줄었으면, 선택지가 줄어드는 것과
        // 같은 순간에 고른 값도 함께 내린다 — 따로 두면 화면은 줄어든
        // 선택지의 첫 값을 그리는데 총액·선점 요청은 예전 수량을 쓴다.
        setRewards(prev => {
          const next = prev.map(r =>
            Object.hasOwn(stock, r.id) ? { ...r, remaining_quantity: stock[r.id] } : r
          )
          const selected = next.find(r => r.id === rewardIdRef.current)
          if (selected && selected.remaining_quantity !== null) {
            const max = Math.max(1, Math.min(MAX_QUANTITY, selected.remaining_quantity))
            setQuantity(q => Math.min(q, max))
          }
          return next
        })
      } catch {
        // 갱신 실패는 조용히 넘긴다 — 서버가 넘겨준 값으로도 후원은 된다.
      }
    })()
    return () => {
      canceled = true
    }
  }, [campaign.slug])

  const reward: Reward | undefined = useMemo(
    () => rewards.find(r => r.id === rewardId),
    [rewards, rewardId]
  )

  /**
   * 추가 후원금은 **입력 중에 정규화하지 않는다.** 글자마다 1,000원 단위로
   * 깎으면 5 → 0, 50 → 0이 되어 대부분의 값을 아예 타이핑할 수 없다
   * (studio가 실제로 겪고 고친 버그다). blur와 제출에서만 다듬는다.
   */
  const additional = useMemo(() => {
    const n = Number(additionalText.replace(/[^0-9]/g, ''))
    return Number.isFinite(n) ? n : 0
  }, [additionalText])

  const total = reward ? reward.amount * quantity + additional : 0

  // blur와 제출이 같은 규칙(내림 + 상한)을 쓴다. 제출에서만 내리고 상한을
  // 빼먹으면, 필드에 눈을 떼지 않고 키보드로 바로 제출하는 사람이 상한을
  // 넘는 값을 그대로 서버에 보내 레이트리밋만 태우고 거절당한다.
  const normalizeAdditionalValue = useCallback(
    (n: number) =>
      Math.min(
        MAX_ADDITIONAL_AMOUNT,
        Math.max(0, Math.floor(n / ADDITIONAL_AMOUNT_STEP) * ADDITIONAL_AMOUNT_STEP)
      ),
    []
  )

  const normalizeAdditional = useCallback(() => {
    const n = normalizeAdditionalValue(additional)
    setAdditionalText(n === 0 ? '' : String(n))
  }, [additional, normalizeAdditionalValue])

  const maxQuantity =
    reward?.remaining_quantity !== null && reward?.remaining_quantity !== undefined
      ? Math.min(MAX_QUANTITY, reward.remaining_quantity)
      : MAX_QUANTITY

  /**
   * 선점(reservation)을 이미 손에 쥔 채로 위젯만 새로 연다. 광고 차단기·
   * 일시적인 스크립트 오류처럼 위젯 쪽만 실패했을 때 쓴다 — 새 선점을
   * 만들지 않으므로, 방금 내가 잡은 재고가 나 자신을 "품절"로 막는 일이
   * 없다.
   */
  const loadWidget = useCallback(
    async (order: Prepared) => {
      try {
        const tossPayments = await loadTossPayments(order.clientKey)
        const widgets = tossPayments.widgets({ customerKey: order.customerKey })
        await widgets.setAmount({ currency: 'KRW', value: order.amount })
        await Promise.all([
          widgets.renderPaymentMethods({
            selector: '#funding-payment-method',
            variantKey: 'DEFAULT',
          }),
          widgets.renderAgreement({
            selector: '#funding-payment-agreement',
            variantKey: 'AGREEMENT',
          }),
        ])
        widgetsRef.current = widgets
        setWidgetReady(true)
      } catch (caught) {
        console.error('결제창 준비 실패:', caught)
        setWidgetReady(false)
        setError(t('fail.defaultMessage'))
      }
    },
    [t]
  )

  const retryWidget = useCallback(async () => {
    if (!reservation) return
    setError('')
    setPreparing(true)
    try {
      await loadWidget(reservation)
    } finally {
      setPreparing(false)
    }
  }, [reservation, loadWidget])

  const startPledge = useCallback(async () => {
    setError('')
    if (!reward) {
      setError(t('form.errorReward'))
      return
    }
    if (reward.remaining_quantity !== null && reward.remaining_quantity <= 0) {
      setError(t('reward.soldOut'))
      return
    }
    if (!backerName.trim()) {
      setError(t('form.errorName'))
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(backerEmail.trim())) {
      setError(t('form.errorEmail'))
      return
    }
    if (reward.requires_shipping) {
      const s = shipping
      if (!s.postcode.trim() || !s.address1.trim() || s.phone.replace(/[^0-9]/g, '').length < 9) {
        setError(t('form.errorShipping'))
        return
      }
    }

    // 화면에 보이는 총액이 실제로 청구될 금액과 같도록, 보낼 값으로 필드도 맞춘다.
    const normalizedAdditional = normalizeAdditionalValue(additional)
    if (normalizedAdditional !== additional) {
      setAdditionalText(normalizedAdditional === 0 ? '' : String(normalizedAdditional))
    }

    setPreparing(true)
    try {
      const res = await fetch('/api/funding/pledges/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          rewardId: reward.id,
          quantity,
          additionalAmount: normalizedAdditional,
          backerName: backerName.trim(),
          backerEmail: backerEmail.trim(),
          backerPhone: backerPhone.replace(/[^0-9]/g, ''),
          supporterMessage: message.trim() || undefined,
          messagePublic,
          isAnonymous,
          // 버튼 아래 고지를 보고 눌렀다는 기록. 체크박스는 두지 않는다.
          agreedTerms: true,
          agreedPrivacy: true,
          ...(reward.requires_shipping
            ? {
                shipping: {
                  name: shipping.name.trim() || backerName.trim(),
                  phone: shipping.phone.replace(/[^0-9]/g, ''),
                  postcode: shipping.postcode.trim(),
                  address1: shipping.address1.trim(),
                  address2: shipping.address2.trim() || undefined,
                  memo: shipping.memo.trim() || undefined,
                },
              }
            : {}),
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        data?: Prepared
        error?: string
      } | null
      if (!res.ok || !body?.data) {
        // 서버가 준 한국어 문구를 그대로 보인다 — 매진·수량 상한·마감이 전부
        // 여기로 온다. 화면이 이유를 다시 추측하지 않는다.
        setError(body?.error || t('fail.defaultMessage'))
        return
      }
      const order = body.data

      // 서버가 선점에 성공한 시점에 즉시 세운다 — 위젯이 이어서 실패해도
      // 이 선점은 잊히지 않는다. 폼 섹션은 이 값이 서는 순간 숨는다(아래
      // 렌더 참고), 그러니 다시 눌러도 `startPledge`가 또 불리지 않는다.
      setReservation(order)
      await loadWidget(order)
    } catch (caught) {
      console.error('후원 준비 실패:', caught)
      setError(t('fail.defaultMessage'))
    } finally {
      setPreparing(false)
    }
  }, [
    reward,
    quantity,
    additional,
    normalizeAdditionalValue,
    backerName,
    backerEmail,
    backerPhone,
    shipping,
    message,
    messagePublic,
    isAnonymous,
    campaign.id,
    loadWidget,
    t,
  ])

  const requestPayment = useCallback(async () => {
    const widgets = widgetsRef.current as {
      requestPayment: (input: Record<string, unknown>) => Promise<void>
    } | null
    if (!widgets || !reservation) return
    try {
      const successUrl = new URL('/funding/success', window.location.origin)
      successUrl.searchParams.set('pledgeId', reservation.pledgeId)
      await widgets.requestPayment({
        orderId: reservation.orderId,
        orderName: reservation.orderName,
        successUrl: successUrl.toString(),
        failUrl: `${window.location.origin}/funding/fail`,
        customerName: reservation.customerName,
        customerEmail: reservation.customerEmail,
      })
    } catch (caught) {
      console.error('결제창 실패:', caught)
      setError(t('fail.defaultMessage'))
    }
  }, [reservation, t])

  // 배너는 폼 맨 위에 있고 제출 버튼은 맨 아래에 있다 — 스크린리더가 읽어
  // 주는 것과 별개로, 화면을 눈으로 보는 사람도 아래에서 제출하면 배너가 바뀐
  // 것을 보지 못한다. 오류가 뜨는 순간 그리로 옮긴다.
  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  if (!paymentEnabled) {
    return (
      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        {t('detail.preparingNotice')}
      </div>
    )
  }

  return (
    <div className="mt-6">
      {error ? (
        <div
          ref={errorRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 outline-none"
        >
          <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {/* 후원 폼 — 선점(reservation)이 서기 전까지만 보인다 */}
      <section
        className={reservation ? 'hidden' : 'rounded-lg border border-gray-200 bg-white p-6'}
      >
        <h2 className="text-lg font-semibold text-gray-900">{t('form.heading')}</h2>

        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900">
              {t('detail.rewardsHeading')}
            </legend>
            <div className="space-y-2">
              {rewards.map(r => {
                const soldOut = r.remaining_quantity !== null && r.remaining_quantity <= 0
                return (
                  <label
                    key={r.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      soldOut
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                        : rewardId === r.id
                          ? 'cursor-pointer border-primary-600 bg-primary-50'
                          : 'cursor-pointer border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reward"
                      value={r.id}
                      checked={rewardId === r.id}
                      disabled={soldOut}
                      aria-disabled={soldOut}
                      onChange={() => {
                        setRewardId(r.id)
                        setQuantity(1)
                      }}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.title}</span>
                        <span className="font-medium tabular-nums">{price(r.amount)}</span>
                      </span>
                      {r.description ? (
                        <span className="mt-1 block text-sm text-gray-600">{r.description}</span>
                      ) : null}
                      <span className="mt-1 block text-xs text-gray-500">
                        {soldOut
                          ? t('reward.soldOut')
                          : r.remaining_quantity === null
                            ? t('reward.unlimited')
                            : t('reward.remaining', { count: r.remaining_quantity })}
                      </span>
                      {/* 배송 여부·예상 발송월. 실물이 오는지, 언제쯤인지는
                          커밋 전에 알아야 한다 — 수량·가격만으로는 안 보인다. */}
                      <span className="mt-1 block text-xs text-gray-500">
                        {r.requires_shipping ? t('reward.shipping') : t('reward.noShipping')}
                        {r.requires_shipping && r.estimated_delivery
                          ? ` · ${t('reward.delivery', { month: r.estimated_delivery })}`
                          : ''}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="quantity" className="mb-2 block text-sm font-medium text-gray-900">
              {t('form.quantity')}
            </label>
            <select
              id="quantity"
              value={quantity}
              onChange={e => setQuantity(Number(e.target.value))}
              disabled={!reward}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 disabled:opacity-50"
            >
              {Array.from({ length: Math.max(1, maxQuantity) }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="additional" className="mb-2 block text-sm font-medium text-gray-900">
              {t('form.additional')}
            </label>
            <input
              id="additional"
              value={additionalText}
              onChange={e => setAdditionalText(e.target.value)}
              onBlur={normalizeAdditional}
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-gray-500">{t('form.additionalHelp')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="backerName" className="mb-2 block text-sm font-medium text-gray-900">
                {t('form.name')}
              </label>
              <input
                id="backerName"
                value={backerName}
                onChange={e => setBackerName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                autoComplete="name"
                required
              />
            </div>
            <div>
              <label htmlFor="backerEmail" className="mb-2 block text-sm font-medium text-gray-900">
                {t('form.email')}
              </label>
              <input
                id="backerEmail"
                type="email"
                value={backerEmail}
                onChange={e => setBackerEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="backerPhone" className="mb-2 block text-sm font-medium text-gray-900">
              {t('form.phone')}
            </label>
            <input
              id="backerPhone"
              value={backerPhone}
              onChange={e => setBackerPhone(e.target.value)}
              placeholder="01012345678"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              autoComplete="tel"
              inputMode="numeric"
            />
          </div>

          {reward?.requires_shipping ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-900">
                {t('form.shippingHeading')}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="shippingName" className="mb-2 block text-sm text-gray-700">
                    {t('form.shippingName')}
                  </label>
                  <input
                    id="shippingName"
                    value={shipping.name}
                    onChange={e => setShipping(s => ({ ...s, name: e.target.value }))}
                    placeholder={backerName}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="shippingPhone" className="mb-2 block text-sm text-gray-700">
                    {t('form.shippingPhone')}
                  </label>
                  <input
                    id="shippingPhone"
                    value={shipping.phone}
                    onChange={e => setShipping(s => ({ ...s, phone: e.target.value }))}
                    inputMode="numeric"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="postcode" className="mb-2 block text-sm text-gray-700">
                    {t('form.postcode')}
                  </label>
                  <input
                    id="postcode"
                    value={shipping.postcode}
                    onChange={e => setShipping(s => ({ ...s, postcode: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="address1" className="mb-2 block text-sm text-gray-700">
                    {t('form.address1')}
                  </label>
                  <input
                    id="address1"
                    value={shipping.address1}
                    onChange={e => setShipping(s => ({ ...s, address1: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="address2" className="mb-2 block text-sm text-gray-700">
                    {t('form.address2')}
                  </label>
                  <input
                    id="address2"
                    value={shipping.address2}
                    onChange={e => setShipping(s => ({ ...s, address2: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="shippingMemo" className="mb-2 block text-sm text-gray-700">
                    {t('form.shippingMemo')}
                  </label>
                  <input
                    id="shippingMemo"
                    value={shipping.memo}
                    onChange={e => setShipping(s => ({ ...s, memo: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>
            </fieldset>
          ) : null}

          <div>
            <label htmlFor="message" className="mb-2 block text-sm font-medium text-gray-900">
              {t('form.message')}
            </label>
            <textarea
              id="message"
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, 300))}
              maxLength={300}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <p className="mt-1 text-xs text-gray-500">{t('form.messageHelp')}</p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={messagePublic}
                onChange={e => setMessagePublic(e.target.checked)}
                className="h-4 w-4"
              />
              {t('form.messagePublic')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={e => setIsAnonymous(e.target.checked)}
                className="h-4 w-4"
              />
              {t('form.anonymous')}
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 pt-5">
            <span className="text-gray-700">{t('form.total')}</span>
            <span className="text-xl font-semibold tabular-nums text-gray-900">
              {t('progress.amount', { amount: formatAmount(total, locale) })}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void startPledge()}
            disabled={preparing || !paymentEnabled}
            className="w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {preparing ? t('form.submitting') : t('form.submit')}
          </button>

          <p className="text-xs text-gray-500">
            {t.rich('form.agreeNotice', {
              // 펀딩 전용 약관 페이지가 생기기 전까지는 조합 공통 약관으로
              // 연결한다. 후속 태스크가 전용 페이지로 바꿀 것이다.
              terms: chunks => <Link href="/terms">{chunks}</Link>,
              privacy: chunks => <Link href="/privacy">{chunks}</Link>,
            })}
          </p>
          <p className="text-xs text-gray-500">{t('form.holdNotice')}</p>
        </div>
      </section>

      {/* 결제창 — 선점이 서 있는 동안만 보인다. 위젯이 아직 안 떴으면
          (실패했거나 다시 여는 중이면) 위젯 자리 대신 재시도 버튼을 보인다 —
          빈 위젯·눌러도 반응 없는 버튼만 남기지 않는다. */}
      <section className={reservation ? 'block' : 'hidden'}>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('form.paymentHeading')}</h2>
        {widgetReady ? (
          <>
            <div id="funding-payment-method" />
            <div id="funding-payment-agreement" />
            <button
              type="button"
              onClick={() => void requestPayment()}
              className="mt-4 w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700"
            >
              {reservation
                ? t('form.payButton', {
                    amount: t('progress.amount', {
                      amount: formatAmount(reservation.amount, locale),
                    }),
                  })
                : t('form.submit')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void retryWidget()}
            disabled={preparing}
            className="w-full rounded-lg border border-primary-600 px-5 py-3 font-medium text-primary-600 transition hover:bg-primary-50 disabled:opacity-50"
          >
            {preparing ? t('form.submitting') : t('form.retryWidget')}
          </button>
        )}
      </section>
    </div>
  )
}
