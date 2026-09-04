'use client'

/**
 * 예매 결제 실패 화면.
 *
 * **여기서는 승인 API를 부르지 않는다.** 결제가 성립하지 않았다는 뜻이고,
 * 잡아 둔 좌석은 10분 뒤 자동으로 반환된다.
 */

import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

import { resolvePaymentFailureMessage } from '../paymentFailure'

function TicketFailContent() {
  const t = useTranslations('tickets')
  const params = useSearchParams()
  const guide = resolvePaymentFailureMessage(t, params.get('code'), params.get('message'))

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 md:pt-40">
      <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 text-center">
        <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">{t('fail.heading')}</h1>
        <p className="mt-2 text-gray-600">{guide}</p>
        <p className="mt-4 text-sm text-gray-500">{t('fail.note')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/tickets"
            className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
          >
            {t('fail.retry')}
          </Link>
          <a
            href="mailto:contact@ggac.kr"
            className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {t('common.contactOffice')}
          </a>
        </div>
      </div>
    </div>
  )
}

function FailFallback() {
  const t = useTranslations('tickets')
  return <div className="min-h-screen pt-40 text-center text-gray-500">{t('common.loading')}</div>
}

/** 공개 페이지라 프리렌더 대상이다 — `useSearchParams()`는 Suspense가 필요하다. */
export default function TicketFailPage() {
  return (
    <Suspense fallback={<FailFallback />}>
      <TicketFailContent />
    </Suspense>
  )
}
