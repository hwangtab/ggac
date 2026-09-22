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
import { useCallback, useMemo, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

import { formatAmount } from '../format'
import type { CampaignDetail, Reward } from '../types'

/** 서버가 정한 한도. `src/lib/funding/amounts.ts`와 같은 값이어야 한다. */
const MAX_QUANTITY = 10
const ADDITIONAL_STEP = 1000
const MAX_ADDITIONAL = 5_000_000

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
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const widgetsRef = useRef<unknown>(null)

  const reward: Reward | undefined = useMemo(
    () => campaign.rewards.find(r => r.id === rewardId),
    [campaign.rewards, rewardId]
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

  const normalizeAdditional = useCallback(() => {
    const n = Math.min(
      MAX_ADDITIONAL,
      Math.max(0, Math.floor(additional / ADDITIONAL_STEP) * ADDITIONAL_STEP)
    )
    setAdditionalText(n === 0 ? '' : String(n))
  }, [additional])

  const maxQuantity =
    reward?.remaining_quantity !== null && reward?.remaining_quantity !== undefined
      ? Math.min(MAX_QUANTITY, reward.remaining_quantity)
      : MAX_QUANTITY

  const startPledge = useCallback(async () => {
    setError('')
    if (!reward) {
      setError(t('reward.select'))
      return
    }
    if (reward.remaining_quantity !== null && reward.remaining_quantity <= 0) {
      setError(t('reward.soldOut'))
      return
    }
    if (!backerName.trim()) {
      setError(t('form.name'))
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(backerEmail.trim())) {
      setError(t('form.email'))
      return
    }
    if (reward.requires_shipping) {
      const s = shipping
      if (!s.postcode.trim() || !s.address1.trim() || s.phone.replace(/[^0-9]/g, '').length < 9) {
        setError(t('form.shippingHeading'))
        return
      }
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
          additionalAmount: Math.floor(additional / ADDITIONAL_STEP) * ADDITIONAL_STEP,
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
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        // 서버가 준 한국어 문구를 그대로 보인다 — 매진·수량 상한·마감이 전부
        // 여기로 온다. 화면이 이유를 다시 추측하지 않는다.
        setError(body?.error || t('fail.defaultMessage'))
        return
      }
      const order = body.data as Prepared
      setPrepared(order)

      const tossPayments = await loadTossPayments(order.clientKey)
      const widgets = tossPayments.widgets({ customerKey: order.customerKey })
      widgetsRef.current = widgets
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
    backerName,
    backerEmail,
    backerPhone,
    shipping,
    message,
    messagePublic,
    isAnonymous,
    campaign.id,
    t,
  ])

  const requestPayment = useCallback(async () => {
    const widgets = widgetsRef.current as {
      requestPayment: (input: Record<string, unknown>) => Promise<void>
    } | null
    if (!widgets || !prepared) return
    try {
      const successUrl = new URL('/funding/success', window.location.origin)
      successUrl.searchParams.set('pledgeId', prepared.pledgeId)
      await widgets.requestPayment({
        orderId: prepared.orderId,
        orderName: prepared.orderName,
        successUrl: successUrl.toString(),
        failUrl: `${window.location.origin}/funding/fail`,
        customerName: prepared.customerName,
        customerEmail: prepared.customerEmail,
      })
    } catch (caught) {
      console.error('결제창 실패:', caught)
      setError(t('fail.defaultMessage'))
    }
  }, [prepared, t])

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
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {/* 후원 폼 — 결제창이 열리기 전까지만 보인다 */}
      <section className={prepared ? 'hidden' : 'rounded-lg border border-gray-200 bg-white p-6'}>
        <h2 className="text-lg font-semibold text-gray-900">{t('form.heading')}</h2>

        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900">
              {t('detail.rewardsHeading')}
            </legend>
            <div className="space-y-2">
              {campaign.rewards.map(r => {
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
              terms: chunks => <Link href="/funding/terms">{chunks}</Link>,
              privacy: chunks => <Link href="/privacy">{chunks}</Link>,
            })}
          </p>
          <p className="text-xs text-gray-500">{t('form.holdNotice')}</p>
        </div>
      </section>

      {/* 결제창 */}
      <section className={prepared ? 'block' : 'hidden'}>
        <div id="funding-payment-method" />
        <div id="funding-payment-agreement" />
        <button
          type="button"
          onClick={() => void requestPayment()}
          className="mt-4 w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700"
        >
          {prepared
            ? t('progress.amount', { amount: formatAmount(prepared.amount, locale) })
            : t('form.submit')}
        </button>
      </section>
    </div>
  )
}
