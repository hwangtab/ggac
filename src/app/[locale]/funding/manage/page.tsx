'use client'

/**
 * 비회원 후원 조회.
 *
 * 로그인하지 않고 후원한 사람이 자기 후원을 확인하고 취소하는 유일한 길이다.
 * 본인 확인은 **후원번호 + 후원할 때 쓴 이메일** 두 가지가 맞아야 한다.
 *
 * 번호만 틀렸을 때와 이메일만 틀렸을 때를 구분해 보이지 않는다 — 구분하면
 * 번호를 넣어 보며 "이 번호는 있다"를 알아낼 수 있다. 서버도 같은 이유로
 * 두 경우 모두 같은 404를 준다.
 */

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

import { formatAmount } from '../format'

interface PledgeView {
  pledge_code: string
  status: string
  reward_title: string
  quantity: number
  additional_amount: number
  total_amount: number
  paid_at: string | null
  fulfillment_status: string
  campaign_slug: string | null
  campaign_title: string | null
  campaign_status: string | null
  // 취소 라우트가 "판단 불가"로 끝나 canceled·결제 연결이 남은 채 멈춘
  // 후원인가. 이 경우 같은 취소 API를 다시 호출하는 것이 곧 복구 경로다.
  refund_retry_possible: boolean
}

export default function FundingManagePage() {
  const t = useTranslations('funding')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [pledge, setPledge] = useState<PledgeView | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [notice, setNotice] = useState('')
  const errorRef = useRef<HTMLDivElement | null>(null)
  const noticeRef = useRef<HTMLDivElement | null>(null)

  // 배너는 화면 위쪽에 있고, 실제로 값이 바뀌는 자리(조회 결과·취소 버튼)는
  // 그 아래다 — 스크린리더뿐 아니라 눈으로 보는 사람도 아래에서 버튼을
  // 누르면 위 배너가 바뀐 걸 못 본다. 뜨는 순간 그리로 옮긴다.
  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])
  useEffect(() => {
    if (notice) {
      noticeRef.current?.focus()
      noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [notice])

  const lookup = useCallback(async () => {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const res = await fetch('/api/funding/pledges/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pledgeCode: code.trim().toUpperCase(), email: email.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setPledge(null)
        setError(t('manage.notFound'))
        return
      }
      setPledge(body.data?.pledge as PledgeView)
    } catch {
      setPledge(null)
      setError(t('manage.notFound'))
    } finally {
      setLoading(false)
    }
  }, [code, email, t])

  const cancel = useCallback(async () => {
    if (!pledge) return
    // 재시도 건(canceled + 결제 연결 남음)은 "취소"가 아니라 "환불이 실제로
    // 나갔는지 다시 확인"이다 — 확인 문구를 다르게 준다. 판정은 취소
    // 라우트와 같은 조건(`refund_retry_possible`)을 서버가 이미 계산해 준다.
    const isRetry = pledge.status === 'canceled' && pledge.refund_retry_possible
    const confirmText = isRetry
      ? t('manage.retryConfirm')
      : t('manage.cancelConfirm', { amount: formatAmount(pledge.total_amount, 'ko') })
    if (!window.confirm(confirmText)) return
    setError('')
    setCanceling(true)
    try {
      const res = await fetch('/api/funding/pledges/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pledgeCode: pledge.pledge_code, email: email.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || t('fail.defaultMessage'))
        return
      }
      // 조회를 먼저 끝내고 안내 문구는 그 뒤에 켠다. lookup()은 첫 줄에서
      // notice를 지우는데, 그걸 먼저 부르고 나서 notice를 켜지 않으면
      // "취소는 성공했지만 안내는 안 뜨는" 결과가 된다(두 setState가 await
      // 이전에 나란히 있으면 리액트가 한 렌더로 묶어 지우기가 이긴다).
      await lookup()
      setNotice(t('manage.canceled'))
    } catch {
      setError(t('fail.defaultMessage'))
    } finally {
      setCanceling(false)
    }
  }, [pledge, email, t, lookup])

  const canCancel =
    pledge?.status === 'paid' &&
    pledge?.campaign_status === 'active' &&
    pledge?.fulfillment_status === 'none'
  const canRetryRefund = pledge?.status === 'canceled' && pledge?.refund_retry_possible === true

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold text-gray-900">{t('manage.heading')}</h1>
        <p className="mt-2 text-gray-600">{t('manage.subtitle')}</p>

        {error ? (
          <div
            ref={errorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 outline-none"
          >
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div
            ref={noticeRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mt-6 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 outline-none"
          >
            {notice}
          </div>
        ) : null}

        <form
          className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-6"
          onSubmit={e => {
            e.preventDefault()
            void lookup()
          }}
        >
          <div>
            <label htmlFor="pledge-code" className="block text-sm font-medium text-gray-700">
              {t('manage.pledgeCode')}
            </label>
            <input
              id="pledge-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="FND-20260922-XXXXXXXX"
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono"
            />
            <p className="mt-1 text-xs text-gray-500">{t('manage.pledgeCodeHelp')}</p>
          </div>
          <div>
            <label htmlFor="pledge-email" className="block text-sm font-medium text-gray-700">
              {t('manage.email')}
            </label>
            <input
              id="pledge-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <button type="submit" disabled={loading} className="tw-btn-primary w-full">
            {loading ? t('manage.submitting') : t('manage.submit')}
          </button>
        </form>

        {pledge ? (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
            {pledge.campaign_slug ? (
              <Link
                href={`/funding/${pledge.campaign_slug}`}
                className="text-primary-600 hover:underline"
              >
                {pledge.campaign_title}
              </Link>
            ) : (
              <p className="text-gray-900">{pledge.campaign_title}</p>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <Row label={t('manage.pledgeCode')} value={pledge.pledge_code} mono />
              <Row
                label={t('detail.rewardsHeading')}
                value={`${pledge.reward_title} × ${pledge.quantity}`}
              />
              <Row
                label={t('form.total')}
                value={t('progress.amount', { amount: formatAmount(pledge.total_amount, 'ko') })}
              />
              <Row label={t('success.title')} value={t(`status.${pledge.status}`)} />
            </dl>
            {canCancel || canRetryRefund ? (
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={canceling}
                className="mt-6 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
              >
                {canRetryRefund
                  ? canceling
                    ? t('manage.retrying')
                    : t('manage.retry')
                  : canceling
                    ? t('manage.canceling')
                    : t('manage.cancel')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-right font-medium text-gray-900${mono ? ' font-mono' : ''}`}>{value}</dd>
    </div>
  )
}
