'use client'

/**
 * 결제 실패 안내.
 *
 * 아무 API도 부르지 않는다 — 선점한 수량은 10분 뒤 만료 크론이 되돌린다.
 *
 * **쿼리의 `message`를 그리지 않는다.** 주소창에 아무 문장이나 넣어 우리
 * 레이아웃으로 보여 줄 수 있어서, 가짜 고객센터 번호를 심는 수단이 된다.
 * 알려진 `code`만 번역 문구로 바꾼다(예매 실패 화면과 같은 규칙).
 */

import { useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'
import { resolvePaymentFailureMessage } from '@/lib/payments/failureMessage'

function FailInner() {
  const t = useTranslations('funding')
  const params = useSearchParams()
  const code = params.get('code')
  // 서버 메시지 자리에 아무것도 넘기지 않는다 — 쿼리의 message는 신뢰하지 않는다.
  const message = resolvePaymentFailureMessage(key => t(key), code, null)

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <FiAlertCircle className="mx-auto h-10 w-10 text-red-500" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">{t('fail.title')}</h1>
        <p className="mt-2 text-gray-600">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/funding" className="tw-btn-primary inline-flex">
            {t('fail.toList')}
          </Link>
          <a href="mailto:contact@ggac.kr" className="tw-btn-secondary inline-flex">
            {t('common.contactOffice')}
          </a>
        </div>
      </div>
    </div>
  )
}

export default function FundingFailPage() {
  return (
    <Suspense fallback={null}>
      <FailInner />
    </Suspense>
  )
}
