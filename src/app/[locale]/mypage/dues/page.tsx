'use client'

/**
 * 조합비 납부 화면.
 *
 * 결제창은 토스 SDK가 이 페이지 안에 그린다(주문서형 결제). 흐름은
 * `준비 요청 → 위젯 렌더 → 결제 요청 → 성공 주소로 리다이렉트`이고, 승인
 * 확정은 성공 화면이 맡는다.
 *
 * 금액을 화면에서 정하지 않는다 — 준비 요청이 돌려준 값을 그대로 쓴다.
 * 여기서 정하면 브라우저 콘솔로 바꿀 수 있다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTossPayments } from '@tosspayments/tosspayments-sdk'
import { FiCheckCircle, FiCreditCard, FiAlertCircle, FiRepeat } from 'react-icons/fi'

import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'

interface DuesStatus {
  paymentEnabled: boolean
  billingEnabled: boolean
  billingMonth: string
  monthlyFee: number | null
  billingClientKey: string
  customerKey: string
  autoPay: {
    registered: boolean
    cardNumberMasked?: string | null
    cardType?: string | null
    registeredAt?: string | null
  }
  dues: { status: string; amount: number | null; paid_at: string | null }
  payments: Array<{
    order_id: string
    order_name: string
    amount: number
    status: string
    method: string | null
    approved_at: string | null
    canceled_amount: number
  }>
}

interface PrepareResult {
  orderId: string
  orderName: string
  amount: number
  clientKey: string
  customerKey: string
  customerName?: string
  customerEmail?: string
}

const WIDGET_SELECTOR = '#toss-payment-method'
const AGREEMENT_SELECTOR = '#toss-payment-agreement'

function formatWon(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toLocaleString('ko-KR')}원` : '-'
}

function formatMonth(billingMonth: string): string {
  const [year, month] = billingMonth.split('-')
  return `${year}년 ${Number(month)}월`
}

export default function DuesPage() {
  const [status, setStatus] = useState<DuesStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<PrepareResult | null>(null)
  const widgetsRef = useRef<Awaited<ReturnType<typeof loadTossPayments>> | null>(null)
  const renderedRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/payments/dues', { credentials: 'include' })
      const result = (await response.json().catch(() => null)) as {
        data?: DuesStatus
        error?: string
      } | null

      if (!response.ok) {
        setError(result?.error ?? '납부 현황을 불러오지 못했습니다.')
        return
      }
      setStatus(result?.data ?? null)
    } catch {
      setError('납부 현황을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  /** 준비 요청 → 위젯 렌더. 위젯은 한 페이지에 하나만 존재할 수 있다. */
  const startPayment = useCallback(async () => {
    setPreparing(true)
    setError(null)
    try {
      const response = await fetch('/api/payments/dues/prepare', {
        method: 'POST',
        credentials: 'include',
      })
      const result = (await response.json().catch(() => null)) as {
        data?: PrepareResult
        error?: string
      } | null

      if (!response.ok || !result?.data) {
        setError(result?.error ?? '결제를 준비하지 못했습니다.')
        return
      }

      const order = result.data
      setPrepared(order)

      const tossPayments = await loadTossPayments(order.clientKey)
      const widgets = tossPayments.widgets({ customerKey: order.customerKey })
      widgetsRef.current = widgets as never

      // 금액을 먼저 설정해야 결제수단 UI를 그릴 수 있다(SDK 요구 순서).
      await widgets.setAmount({ currency: 'KRW', value: order.amount })
      await Promise.all([
        widgets.renderPaymentMethods({ selector: WIDGET_SELECTOR, variantKey: 'DEFAULT' }),
        widgets.renderAgreement({ selector: AGREEMENT_SELECTOR, variantKey: 'AGREEMENT' }),
      ])
      renderedRef.current = true
    } catch (caught) {
      console.error('결제 준비 실패:', caught)
      setError('결제창을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setPreparing(false)
    }
  }, [])

  /** 카드 등록 창을 연다. 이 단계에서는 돈이 빠져나가지 않는다. */
  const registerCard = useCallback(async () => {
    if (!status) return
    setError(null)
    try {
      const tossPayments = await loadTossPayments(status.billingClientKey)
      const payment = tossPayments.payment({ customerKey: status.customerKey })
      await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: `${window.location.origin}/mypage/dues/billing/success`,
        failUrl: `${window.location.origin}/mypage/dues/fail`,
        // PC 기본값은 iframe인데, 그 안에서 카드사 인증 스크립트가 토스 쪽
        // 보안 정책에 막혀 조용히 멈춘다(실측: "Evaluating a string as
        // JavaScript violates..." — 우리 정책이 아니라 결제 페이지의 정책이다).
        // 전체 페이지로 이동하면 그 제약을 받지 않는다.
        windowTarget: 'self',
      })
    } catch (caught) {
      console.error('카드 등록 실패:', caught)
      setError('카드 등록 창을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [status])

  const cancelAutoPay = useCallback(async () => {
    if (!window.confirm('자동결제를 해지하시겠습니까? 다음 달부터 청구되지 않습니다.')) return
    setError(null)
    try {
      const response = await fetch('/api/payments/billing', {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null
        setError(result?.error ?? '자동결제를 해지하지 못했습니다.')
        return
      }
      await fetchStatus()
    } catch {
      setError('자동결제를 해지하지 못했습니다.')
    }
  }, [fetchStatus])

  const requestPayment = useCallback(async () => {
    const widgets = widgetsRef.current as never as {
      requestPayment: (input: Record<string, unknown>) => Promise<void>
    } | null
    if (!widgets || !prepared) return

    try {
      await widgets.requestPayment({
        orderId: prepared.orderId,
        orderName: prepared.orderName,
        successUrl: `${window.location.origin}/mypage/dues/success`,
        failUrl: `${window.location.origin}/mypage/dues/fail`,
        customerName: prepared.customerName,
        customerEmail: prepared.customerEmail,
      })
    } catch (caught) {
      console.error('결제 요청 실패:', caught)
      setError('결제를 시작하지 못했습니다. 다시 시도해 주세요.')
    }
  }, [prepared])

  const isPaid = status?.dues.status === 'paid'

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title="조합비" description="월 조합비를 납부하고 내역을 확인하세요.">
        {loading ? (
          <div className="py-12 text-center text-gray-500">불러오는 중…</div>
        ) : (
          <div className="space-y-8">
            {error && (
              <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
                <FiAlertCircle className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* 이번 달 현황 */}
            {status && (
              <section className="rounded-lg border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  {formatMonth(status.billingMonth)} 조합비
                </h2>

                {isPaid ? (
                  <div className="mt-4 flex items-center gap-3 text-green-700">
                    <FiCheckCircle className="h-6 w-6 flex-none" aria-hidden />
                    <div>
                      <p className="font-medium">납부 완료</p>
                      <p className="text-sm text-gray-600">
                        {formatWon(status.dues.amount)}
                        {status.dues.paid_at &&
                          ` · ${new Date(status.dues.paid_at).toLocaleDateString('ko-KR')}`}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <p className="text-2xl font-semibold text-gray-900">
                      {formatWon(status.dues.amount ?? status.monthlyFee)}
                    </p>
                    {status.monthlyFee === null && (
                      <p className="mt-2 text-sm text-amber-700">
                        월 회비 금액이 설정되어 있지 않습니다. 사무국으로 문의해 주세요.
                      </p>
                    )}
                    {!status.paymentEnabled && (
                      <p className="mt-2 text-sm text-gray-600">
                        결제 기능을 준비하고 있습니다. 조금만 기다려 주세요.
                      </p>
                    )}
                    {status.paymentEnabled && status.monthlyFee !== null && !prepared && (
                      <button
                        type="button"
                        onClick={() => void startPayment()}
                        disabled={preparing}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
                      >
                        <FiCreditCard className="h-4 w-4" aria-hidden />
                        {preparing ? '결제창을 여는 중…' : '조합비 결제하기'}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* 자동결제 */}
            {status?.billingEnabled && (
              <section className="rounded-lg border border-gray-200 bg-white p-6">
                <div className="flex items-start gap-3">
                  <FiRepeat className="mt-1 h-5 w-5 flex-none text-primary-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-gray-900">자동결제</h2>

                    {status.autoPay.registered ? (
                      <>
                        <p className="mt-1 text-gray-600">
                          매달 조합비가 자동으로 결제됩니다.
                          {status.autoPay.cardNumberMasked && (
                            <span className="ml-1 text-gray-900">
                              {status.autoPay.cardNumberMasked}
                            </span>
                          )}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void registerCard()}
                            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                          >
                            카드 변경
                          </button>
                          <button
                            type="button"
                            onClick={() => void cancelAutoPay()}
                            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                          >
                            자동결제 해지
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-gray-600">
                          카드를 한 번 등록하면 매달 조합비가 자동으로 결제됩니다. 해지는 언제든지
                          하실 수 있습니다.
                        </p>
                        <button
                          type="button"
                          onClick={() => void registerCard()}
                          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-primary-600 px-4 py-2 text-sm font-medium text-primary-700 transition hover:bg-primary-50"
                        >
                          <FiCreditCard className="h-4 w-4" aria-hidden />
                          자동결제 등록
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* 결제창 — 준비된 뒤에만 보인다 */}
            <section className={prepared ? 'block' : 'hidden'}>
              <div id="toss-payment-method" />
              <div id="toss-payment-agreement" />
              <button
                type="button"
                onClick={() => void requestPayment()}
                className="mt-4 w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700"
              >
                {prepared ? `${formatWon(prepared.amount)} 결제하기` : '결제하기'}
              </button>
            </section>

            {/* 납부 내역 */}
            {status && status.payments.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900">납부 내역</h2>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-4 py-2 font-medium">내역</th>
                        <th className="px-4 py-2 font-medium">금액</th>
                        <th className="px-4 py-2 font-medium">수단</th>
                        <th className="px-4 py-2 font-medium">일시</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.payments.map(payment => (
                        <tr key={payment.order_id} className="border-t border-gray-100">
                          <td className="px-4 py-2.5 text-gray-900">
                            {payment.order_name}
                            {payment.status !== 'done' && (
                              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                                {payment.status === 'canceled' ? '환불' : '부분 환불'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-gray-900">
                            {formatWon(payment.amount)}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">{payment.method ?? '-'}</td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {payment.approved_at
                              ? new Date(payment.approved_at).toLocaleDateString('ko-KR')
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </MypageLayout>
    </PermissionCheck>
  )
}
