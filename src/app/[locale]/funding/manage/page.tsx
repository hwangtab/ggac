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
import { useCallback, useState } from 'react'
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
    if (!window.confirm(t('manage.cancelConfirm'))) return
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
      setNotice(t('manage.canceled'))
      await lookup()
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

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold text-gray-900">{t('manage.heading')}</h1>
        <p className="mt-2 text-gray-600">{t('manage.subtitle')}</p>

        {error ? (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
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
            {canCancel ? (
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={canceling}
                className="mt-6 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
              >
                {canceling ? t('manage.canceling') : t('manage.cancel')}
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
