'use client'

/**
 * 결제 성공 화면 — 여기서 **승인을 확정**한다.
 *
 * 토스가 이 주소로 돌려보낸 시점에는 아직 결제가 끝난 게 아니다. 서버가
 * 승인 API를 불러야 비로소 결제가 완료된다. 그래서 이 화면은 "성공했습니다"를
 * 먼저 띄우지 않고, 확정 결과를 받은 뒤에 보여준다.
 *
 * 새로고침해도 안전하다 — 확정 라우트가 이미 확정된 주문을 성공으로 답한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FiCheckCircle, FiAlertCircle, FiLoader } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'
import MypageLayout from '../../components/MypageLayout'
import PermissionCheck from '../../components/PermissionCheck'

type Phase = 'confirming' | 'done' | 'failed'

export default function DuesSuccessPage() {
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('confirming')
  const [message, setMessage] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  // 리액트 개발 모드의 이중 실행으로 승인이 두 번 나가지 않게 막는다.
  const startedRef = useRef(false)

  const confirm = useCallback(async () => {
    const paymentKey = params.get('paymentKey')
    const orderId = params.get('orderId')
    const paidAmount = params.get('amount')

    if (!paymentKey || !orderId) {
      setPhase('failed')
      setMessage('결제 정보가 올바르지 않습니다. 마이페이지에서 납부 상태를 확인해 주세요.')
      return
    }

    try {
      const response = await fetch('/api/payments/dues/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentKey, orderId, amount: paidAmount }),
      })
      const result = (await response.json().catch(() => null)) as {
        data?: { amount?: number }
        error?: string
      } | null

      if (!response.ok) {
        setPhase('failed')
        setMessage(result?.error ?? '결제를 확정하지 못했습니다.')
        return
      }

      setAmount(result?.data?.amount ?? null)
      setPhase('done')
    } catch {
      setPhase('failed')
      setMessage(
        '결제 결과를 확인하지 못했습니다. 카드에서 결제가 되었을 수 있으니 마이페이지에서 납부 상태를 확인해 주세요.'
      )
    }
  }, [params])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void confirm()
  }, [confirm])

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title="조합비 결제" description="결제 결과를 확인합니다.">
        <div className="py-10 text-center">
          {phase === 'confirming' && (
            <>
              <FiLoader className="mx-auto h-10 w-10 animate-spin text-primary-600" aria-hidden />
              <p className="mt-4 text-gray-700">결제를 확정하는 중입니다. 창을 닫지 말아 주세요.</p>
            </>
          )}

          {phase === 'done' && (
            <>
              <FiCheckCircle className="mx-auto h-12 w-12 text-green-600" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold text-gray-900">
                조합비 납부가 완료되었습니다
              </h2>
              {amount !== null && (
                <p className="mt-1 text-gray-600">{amount.toLocaleString('ko-KR')}원</p>
              )}
              <Link
                href="/mypage/dues"
                className="mt-6 inline-block rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
              >
                납부 내역 보기
              </Link>
            </>
          )}

          {phase === 'failed' && (
            <>
              <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold text-gray-900">
                결제를 확정하지 못했습니다
              </h2>
              <p className="mx-auto mt-2 max-w-md text-gray-600">{message}</p>
              <Link
                href="/mypage/dues"
                className="mt-6 inline-block rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                조합비 화면으로
              </Link>
            </>
          )}
        </div>
      </MypageLayout>
    </PermissionCheck>
  )
}
