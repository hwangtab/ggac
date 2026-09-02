'use client'

/** 내 예매 내역. 공연 당일 예매번호를 확인하는 화면이다. */

import { useEffect, useState } from 'react'
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

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/mypage/tickets', { credentials: 'include' })
        const result = (await response.json().catch(() => null)) as {
          data?: { reservations?: Reservation[] }
        } | null
        setReservations(result?.data?.reservations ?? [])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title="예매 내역" description="예매하신 공연과 예매번호를 확인하세요.">
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
