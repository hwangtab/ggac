'use client'

/**
 * 예매 성공 화면 — 여기서 **승인을 확정하고 좌석을 확정**한다.
 *
 * 토스가 이 주소로 돌려보낸 시점에는 아직 결제가 끝난 게 아니다. 그래서
 * "예매되었습니다"를 먼저 띄우지 않고 확정 결과를 받은 뒤에 보여준다.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FiCheckCircle, FiAlertCircle, FiLoader } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

type Phase = 'confirming' | 'done' | 'failed'

function TicketSuccessContent() {
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
      setMessage('예매 정보가 올바르지 않습니다. 결제가 되었는지 사무국으로 확인해 주세요.')
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
        setMessage(result?.error ?? '예매를 확정하지 못했습니다.')
        return
      }

      setCode(result?.data?.reservationCode ?? null)
      setPhase('done')
    } catch {
      setPhase('failed')
      setMessage(
        '결제 결과를 확인하지 못했습니다. 카드에서 결제가 되었을 수 있으니 사무국으로 문의해 주세요.'
      )
    }
  }, [params])

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
            <p className="mt-4 text-gray-700">예매를 확정하는 중입니다. 창을 닫지 말아 주세요.</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <FiCheckCircle className="mx-auto h-12 w-12 text-green-600" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-gray-900">예매가 완료되었습니다</h1>
            {code && (
              <div className="mt-5 rounded-lg bg-gray-50 p-4">
                <p className="text-sm text-gray-600">예매번호</p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-wider text-gray-900">
                  {code}
                </p>
              </div>
            )}
            <p className="mt-4 text-sm text-gray-600">
              공연 당일 입구에서 <strong>예매번호와 연락처</strong>를 말씀해 주세요. 별도 티켓은
              발송되지 않습니다.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/tickets"
                className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
              >
                다른 공연 보기
              </Link>
              <Link
                href="/mypage/tickets"
                className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                예매 내역
              </Link>
            </div>
          </>
        )}

        {phase === 'failed' && (
          <>
            <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-gray-900">예매를 확정하지 못했습니다</h1>
            <p className="mt-2 text-gray-600">{message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/tickets"
                className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
              >
                공연 목록으로
              </Link>
              <a
                href="mailto:contact@ggac.kr"
                className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                사무국에 문의
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * `useSearchParams()`는 서버에서 미리 그릴 수 없다. 공개 페이지라 Next.js가
 * 프리렌더를 시도하므로 Suspense로 감싸야 빌드가 통과한다.
 */
export default function TicketSuccessPage() {
  return (
    <Suspense
      fallback={<div className="min-h-screen pt-40 text-center text-gray-500">불러오는 중…</div>}
    >
      <TicketSuccessContent />
    </Suspense>
  )
}
