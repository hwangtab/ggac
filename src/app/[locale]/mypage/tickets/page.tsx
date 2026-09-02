'use client'

/** 내 예매 내역. 공연 당일 예매번호를 확인하는 화면이다. */

import { useCallback, useEffect, useState } from 'react'
import { FiCalendar, FiMapPin } from 'react-icons/fi'

import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'

interface Reservation {
  id: string
  reservation_code: string
  performance_title: string
  venue: string | null
  starts_at: string | null
  ticket_type_name: string
  quantity: number
  total_amount: number
  status: string
  refund: {
    refundable: boolean
    refund_amount: number
    deduction_rate: number
    reason: string
  } | null
}

function formatShow(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MyTicketsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [canceling, setCanceling] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/mypage/tickets', { credentials: 'include' })
      const result = (await response.json().catch(() => null)) as {
        data?: { reservations?: Reservation[] }
      } | null
      setReservations(result?.data?.reservations ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const cancel = useCallback(
    async (reservation: Reservation) => {
      const refund = reservation.refund
      if (!refund?.refundable) return

      // 얼마가 돌아오는지 확인시킨 뒤에 진행한다. 공제가 있는데 모르고
      // 취소하면 그대로 항의로 이어진다.
      const confirmed = window.confirm(
        `예매를 취소하시겠습니까?\n\n${refund.reason}\n환불 금액: ${refund.refund_amount.toLocaleString('ko-KR')}원`
      )
      if (!confirmed) return

      setCanceling(reservation.id)
      setError(null)
      setMessage(null)
      try {
        const response = await fetch('/api/tickets/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reservationId: reservation.id }),
        })
        const result = (await response.json().catch(() => null)) as {
          data?: { refundAmount?: number }
          error?: string
        } | null

        if (!response.ok) {
          setError(result?.error ?? '예매를 취소하지 못했습니다.')
          return
        }
        setMessage(
          `예매가 취소되었습니다. ${(result?.data?.refundAmount ?? 0).toLocaleString('ko-KR')}원이 환불됩니다.`
        )
        await load()
      } catch {
        setError('예매를 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      } finally {
        setCanceling(null)
      }
    },
    [load]
  )

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title="예매 내역" description="예매하신 공연과 예매번호를 확인하세요.">
        {message && (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <p className="py-12 text-center text-gray-500">불러오는 중…</p>
        ) : reservations.length === 0 ? (
          <p className="py-12 text-center text-gray-600">예매 내역이 없습니다.</p>
        ) : (
          <ul className="space-y-4">
            {reservations.map(reservation => (
              <li
                key={reservation.id}
                className={`rounded-lg border p-5 ${
                  reservation.status === 'canceled'
                    ? 'border-gray-200 bg-gray-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900">
                      {reservation.performance_title}
                      {reservation.status === 'canceled' && (
                        <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                          취소됨
                        </span>
                      )}
                    </h2>
                    <dl className="mt-2 space-y-1 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <FiCalendar className="h-4 w-4 flex-none" aria-hidden />
                        <dd>{formatShow(reservation.starts_at)}</dd>
                      </div>
                      {reservation.venue && (
                        <div className="flex items-center gap-1.5">
                          <FiMapPin className="h-4 w-4 flex-none" aria-hidden />
                          <dd>{reservation.venue}</dd>
                        </div>
                      )}
                    </dl>
                    <p className="mt-2 text-sm text-gray-600">
                      {reservation.ticket_type_name} {reservation.quantity}매 ·{' '}
                      {reservation.total_amount.toLocaleString('ko-KR')}원
                    </p>
                  </div>

                  <div className="rounded-lg bg-gray-50 px-4 py-3 text-center">
                    <p className="text-xs text-gray-600">예매번호</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold tracking-wider text-gray-900">
                      {reservation.reservation_code}
                    </p>
                  </div>
                </div>

                {reservation.status === 'confirmed' && reservation.refund && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                    <p className="text-sm text-gray-600">{reservation.refund.reason}</p>
                    {reservation.refund.refundable && (
                      <button
                        type="button"
                        onClick={() => void cancel(reservation)}
                        disabled={canceling === reservation.id}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                      >
                        {canceling === reservation.id ? '취소하는 중…' : '예매 취소'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-sm text-gray-500">
          공연 당일 입구에서 예매번호와 연락처를 말씀해 주세요. 취소·환불은
          사무국(contact@ggac.kr)으로 문의해 주세요.
        </p>
      </MypageLayout>
    </PermissionCheck>
  )
}
