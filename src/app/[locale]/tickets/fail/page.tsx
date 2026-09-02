'use client'

/**
 * 예매 결제 실패 화면.
 *
 * **여기서는 승인 API를 부르지 않는다.** 결제가 성립하지 않았다는 뜻이고,
 * 잡아 둔 좌석은 10분 뒤 자동으로 반환된다.
 */

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

const GUIDE: Record<string, string> = {
  PAY_PROCESS_CANCELED: '결제를 취소하셨습니다. 좌석은 자동으로 반환됩니다.',
  PAY_PROCESS_ABORTED: '결제가 중단되었습니다. 잠시 후 다시 시도해 주세요.',
  REJECT_CARD_COMPANY: '카드사에서 결제를 거절했습니다. 다른 카드로 시도해 주세요.',
  REJECT_CARD_PAYMENT: '한도 초과 또는 잔액 부족으로 결제되지 않았습니다.',
  INVALID_CARD_EXPIRATION: '카드 유효기간이 올바르지 않습니다.',
}

function TicketFailContent() {
  const params = useSearchParams()
  const code = params.get('code') ?? ''
  const tossMessage = params.get('message') ?? ''
  const guide = GUIDE[code] || tossMessage || '결제가 완료되지 않았습니다.'

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 md:pt-40">
      <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 text-center">
        <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">결제가 완료되지 않았습니다</h1>
        <p className="mt-2 text-gray-600">{guide}</p>
        <p className="mt-4 text-sm text-gray-500">
          결제되지 않았으므로 예매도 되지 않았습니다. 잡아 둔 좌석은 잠시 후 자동으로 반환됩니다.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/tickets"
            className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
          >
            다시 예매하기
          </Link>
          <a
            href="mailto:contact@ggac.kr"
            className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            사무국에 문의
          </a>
        </div>
      </div>
    </div>
  )
}

/** 공개 페이지라 프리렌더 대상이다 — `useSearchParams()`는 Suspense가 필요하다. */
export default function TicketFailPage() {
  return (
    <Suspense
      fallback={<div className="min-h-screen pt-40 text-center text-gray-500">불러오는 중…</div>}
    >
      <TicketFailContent />
    </Suspense>
  )
}
