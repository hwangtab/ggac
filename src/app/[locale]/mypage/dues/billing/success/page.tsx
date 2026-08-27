'use client'

/**
 * 카드 등록 성공 화면 — 여기서 **빌링키를 발급받아 저장**한다.
 *
 * 토스가 돌려준 `authKey`는 일회성 인증값이라 이 화면이 서버에 넘겨야 비로소
 * 자동결제가 등록된다. 그래서 "등록되었습니다"를 먼저 띄우지 않고, 저장이
 * 끝난 결과를 받은 뒤에 보여준다 — 빌링키는 다시 발급받을 수 없어서,
 * 저장 실패를 성공으로 보여주면 회원은 등록된 줄 알고 다음 달을 기다린다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FiCheckCircle, FiAlertCircle, FiLoader } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'
import MypageLayout from '../../../components/MypageLayout'
import PermissionCheck from '../../../components/PermissionCheck'

type Phase = 'registering' | 'done' | 'failed'

export default function BillingSuccessPage() {
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('registering')
  const [message, setMessage] = useState('')
  const [card, setCard] = useState<string | null>(null)
  const startedRef = useRef(false)

  const register = useCallback(async () => {
    const authKey = params.get('authKey')
    const customerKey = params.get('customerKey')

    if (!authKey || !customerKey) {
      setPhase('failed')
      setMessage('카드 등록 정보가 올바르지 않습니다. 다시 시도해 주세요.')
      return
    }

    try {
      const response = await fetch('/api/payments/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ authKey, customerKey }),
      })
      const result = (await response.json().catch(() => null)) as {
        data?: { cardNumberMasked?: string | null }
        error?: string
      } | null

      if (!response.ok) {
        setPhase('failed')
        setMessage(result?.error ?? '카드를 등록하지 못했습니다.')
        return
      }

      setCard(result?.data?.cardNumberMasked ?? null)
      setPhase('done')
    } catch {
      setPhase('failed')
      setMessage('카드 등록 결과를 확인하지 못했습니다. 마이페이지에서 등록 상태를 확인해 주세요.')
    }
  }, [params])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void register()
  }, [register])

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title="자동결제 등록" description="카드 등록 결과를 확인합니다.">
        <div className="py-10 text-center">
          {phase === 'registering' && (
            <>
              <FiLoader className="mx-auto h-10 w-10 animate-spin text-primary-600" aria-hidden />
              <p className="mt-4 text-gray-700">카드를 등록하는 중입니다. 창을 닫지 말아 주세요.</p>
            </>
          )}

          {phase === 'done' && (
            <>
              <FiCheckCircle className="mx-auto h-12 w-12 text-green-600" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold text-gray-900">
                자동결제가 등록되었습니다
              </h2>
              {card && <p className="mt-1 text-gray-600">{card}</p>}
              <p className="mx-auto mt-3 max-w-md text-sm text-gray-600">
                다음 달부터 조합비가 자동으로 결제됩니다. 해지는 마이페이지에서 언제든지 하실 수
                있습니다.
              </p>
              <Link
                href="/mypage/dues"
                className="mt-6 inline-block rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700"
              >
                조합비 화면으로
              </Link>
            </>
          )}

          {phase === 'failed' && (
            <>
              <FiAlertCircle className="mx-auto h-12 w-12 text-amber-600" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold text-gray-900">
                자동결제를 등록하지 못했습니다
              </h2>
              <p className="mx-auto mt-2 max-w-md text-gray-600">{message}</p>
              <p className="mt-4 text-sm text-gray-500">카드에서 출금된 금액은 없습니다.</p>
              <Link
                href="/mypage/dues"
                className="mt-6 inline-block rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                다시 시도하기
              </Link>
            </>
          )}
        </div>
      </MypageLayout>
    </PermissionCheck>
  )
}
