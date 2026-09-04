'use client'

/**
 * 예매 성공 화면 — 여기서 **승인을 확정하고 좌석을 확정**한다.
 *
 * 토스가 이 주소로 돌려보낸 시점에는 아직 결제가 끝난 게 아니다. 그래서
 * "예매되었습니다"를 먼저 띄우지 않고 확정 결과를 받은 뒤에 보여준다.
 */

import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertCircle, FiCheckCircle, FiLoader } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

import { resolvePaymentFailureMessage } from '../paymentFailure'

type Phase = 'confirming' | 'done' | 'failed'

function TicketSuccessContent() {
  const t = useTranslations('tickets')
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('confirming')
  const [message, setMessage] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const startedRef = useRef(false)

  const confirm = useCallback(async () => {
    const paymentKey = params.get('paymentKey')
    const orderId = params.get('orderId')
    const amount = params.get('amount')
    const reservationId = params.get('reservationId')

    if (!paymentKey || !orderId || !reservationId) {
      setPhase('failed')
      setMessage(t('success.missingParams'))
      return
    }

    try {
      const response = await fetch('/api/tickets/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentKey, orderId, amount, reservationId }),
      })
      const result = (await response.json().catch(() => null)) as {
        data?: { reservationCode?: string }
        error?: string
      } | null

      if (!response.ok) {
        setPhase('failed')
        // 실패 사유는 `/tickets/fail`과 같은 매핑을 쓴다 — 결제사 코드가 붙어
        // 돌아오는 경우(일부 결제수단)를 여기서도 사람이 읽는 문장으로 바꾼다.
        setMessage(
          resolvePaymentFailureMessage(
            t,
            params.get('code'),
            result?.error ?? t('success.confirmFailed')
          )
        )
        return
      }

      setCode(result?.data?.reservationCode ?? null)
      setPhase('done')
    } catch {
      setPhase('failed')
      setMessage(t('success.networkFailed'))
    }
  }, [params, t])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void confirm()
  }, [confirm])

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 md:pt-40">
      <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 text-center">
        {phase === 'confirming' && (
          <>
            <FiLoader className="mx-auto h-10 w-10 animate-spin text-primary-600" aria-hidden />
            <p className="mt-4 text-gray-700">{t('success.confirming')}</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <FiCheckCircle className="mx-auto h-12 w-12 text-green-600" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-gray-900">{t('success.heading')}</h1>
            {code && (
              <div className="mt-5 rounded-lg bg-gray-50 p-4">
                <p className="text-sm text-gray-600">{t('success.codeLabel')}</p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-wider text-gray-900">
                  {code}
                </p>
              </div>
            )}
            <p className="mt-4 text-sm text-gray-600">
              {t.rich('success.entryNote', { strong: chunks => <strong>{chunks}</strong> })}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/tickets"
                className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
              >
                {t('success.otherShows')}
              </Link>
              <Link
                href="/mypage/tickets"
                className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                {t('success.myTickets')}
              </Link>
            </div>
          </>
        )}

        {phase === 'failed' && (
          <>
            <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-gray-900">
              {t('success.failedHeading')}
            </h1>
            <p className="mt-2 text-gray-600">{message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/tickets"
                className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
              >
                {t('success.backToList')}
              </Link>
              <a
                href="mailto:contact@ggac.kr"
                className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                {t('common.contactOffice')}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SuccessFallback() {
  const t = useTranslations('tickets')
  return <div className="min-h-screen pt-40 text-center text-gray-500">{t('common.loading')}</div>
}

/**
 * `useSearchParams()`는 서버에서 미리 그릴 수 없다. 공개 페이지라 Next.js가
 * 프리렌더를 시도하므로 Suspense로 감싸야 빌드가 통과한다.
 */
export default function TicketSuccessPage() {
  return (
    <Suspense fallback={<SuccessFallback />}>
      <TicketSuccessContent />
    </Suspense>
  )
}
