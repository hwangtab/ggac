'use client'

/**
 * 결제 승인 확정.
 *
 * **이 주소에 도착한 것은 결제 성공이 아니다.** 토스는 리다이렉트만 하고,
 * 승인은 `/api/funding/pledges/confirm`이 서버에서 금액을 대조해 확정한다.
 * 그래서 확인이 끝나기 전에는 "후원이 확정되었습니다"를 쓰지 않는다.
 */

import { useTranslations } from 'next-intl'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FiCheckCircle, FiAlertCircle, FiLoader } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

import { formatAmount } from '../format'

type Phase = 'confirming' | 'done' | 'failed'

function SuccessInner() {
  const t = useTranslations('funding')
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('confirming')
  const [pledgeCode, setPledgeCode] = useState('')
  const [amount, setAmount] = useState(0)
  const [failMessage, setFailMessage] = useState('')
  // React 18 StrictMode가 effect를 두 번 부른다. 승인은 멱등이지만 요청을
  // 두 번 보낼 이유가 없다.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const paymentKey = params.get('paymentKey') ?? ''
    const orderId = params.get('orderId') ?? ''
    const rawAmount = params.get('amount') ?? ''
    const pledgeId = params.get('pledgeId') ?? ''
    if (!paymentKey || !orderId || !pledgeId) {
      setPhase('failed')
      setFailMessage(t('fail.defaultMessage'))
      return
    }

    void (async () => {
      try {
        const res = await fetch('/api/funding/pledges/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentKey, orderId, pledgeId, amount: rawAmount }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          setPhase('failed')
          // 서버가 이미 사람이 읽는 한국어 문구를 준다. 그대로 보인다.
          setFailMessage(body?.error || t('fail.defaultMessage'))
          return
        }
        setPledgeCode(String(body.data?.pledgeCode ?? ''))
        setAmount(Number(body.data?.amount ?? 0))
        setPhase('done')
      } catch {
        setPhase('failed')
        setFailMessage(t('fail.defaultMessage'))
      }
    })()
  }, [params, t])

  if (phase === 'confirming') {
    return (
      <Shell>
        <FiLoader className="mx-auto h-10 w-10 animate-spin text-primary-600" aria-hidden />
        <p className="mt-4 text-gray-700">{t('success.confirming')}</p>
      </Shell>
    )
  }

  if (phase === 'failed') {
    return (
      <Shell>
        <FiAlertCircle className="mx-auto h-10 w-10 text-red-500" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">{t('fail.title')}</h1>
        <p className="mt-2 text-gray-600">{failMessage}</p>
        <Link href="/funding" className="tw-btn-primary mt-6 inline-flex">
          {t('fail.toList')}
        </Link>
      </Shell>
    )
  }

  return (
    <Shell>
      <FiCheckCircle className="mx-auto h-10 w-10 text-green-500" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-gray-900">{t('success.title')}</h1>
      <p className="mt-2 text-gray-600">{t('success.body')}</p>
      <dl className="mt-6 space-y-2 rounded-lg bg-gray-50 p-4 text-left text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">{t('success.pledgeCode')}</dt>
          <dd className="font-mono font-medium text-gray-900">{pledgeCode}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">{t('success.amount')}</dt>
          <dd className="font-medium text-gray-900">
            {t('progress.amount', { amount: formatAmount(amount, 'ko') })}
          </dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-col gap-2">
        <Link href="/mypage/funding" className="tw-btn-primary">
          {t('success.toMypage')}
        </Link>
        <Link href="/funding/manage" className="tw-btn-secondary">
          {t('success.toLookup')}
        </Link>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        {children}
      </div>
    </div>
  )
}

export default function FundingSuccessPage() {
  // useSearchParams를 쓰는 페이지는 Suspense로 감싸지 않으면 프리렌더가 실패한다.
  return (
    <Suspense
      fallback={
        <Shell>
          <FiLoader className="mx-auto h-10 w-10 animate-spin text-primary-600" aria-hidden />
        </Shell>
      }
    >
      <SuccessInner />
    </Suspense>
  )
}
