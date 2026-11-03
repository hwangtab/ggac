'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { formatTimebankMinutes, timebankFetch } from '@/components/timebank/timebankFormat'

/** `GET /api/timebank/me`(`summarizeMe`). 조합 서비스 사용량(1-B)은 화면에 그리지 않는다. */
type MeSummary = {
  enabled: boolean
  coop_tasks_enabled: boolean
  month: string
  balance_minutes: number
  floor_minutes: number
  room_to_floor_minutes: number
  coop_task: { received_minutes: number; cap_minutes: number }
  pending: { to_confirm: number; awaiting_other: number }
}

/**
 * 잔액 영역(스펙 §8): 잔액, 하한까지 남은 시간, 이번 달 조합 업무 받은 양/상한, 대기 수.
 * 조합 업무 칸은 스위치(`coop_tasks_enabled` — 서버가 전체 스위치와 함께 `=== true`로
 * 판정한 값)가 켜졌을 때만 그린다.
 */
export default function BalancePanel({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations('timebank')
  const [me, setMe] = useState<MeSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void timebankFetch<MeSummary>('/api/timebank/me', {}, t('my.loadError')).then(result => {
      if (!alive) return
      if (result.ok) {
        setMe(result.data)
        setError(null)
      } else setError(result.error)
    })
    return () => {
      alive = false
    }
  }, [refreshKey, t])

  const fmt = (minutes: number) => formatTimebankMinutes(t, minutes)

  return (
    <section aria-labelledby="tb-balance-heading" data-testid="timebank-balance">
      <h2 id="tb-balance-heading" className="mb-3 text-lg font-semibold text-gray-900">
        {t('my.balance.heading')}
      </h2>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!me && !error && <div className="h-24 animate-pulse rounded-lg bg-gray-100" />}
      {me && (
        <div
          className={`grid gap-3 sm:grid-cols-2 ${me.coop_tasks_enabled === true ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
        >
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
            <p className="text-xs text-violet-700">{t('my.balance.balance')}</p>
            <p
              className={`mt-1 text-2xl font-bold ${me.balance_minutes < 0 ? 'text-red-700' : 'text-violet-900'}`}
              data-testid="timebank-balance-value"
              data-minutes={me.balance_minutes}
            >
              {fmt(me.balance_minutes)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">{t('my.balance.roomToFloor')}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">
              {fmt(me.room_to_floor_minutes)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('my.balance.floor', { floor: fmt(me.floor_minutes) })}
            </p>
          </div>
          {me.coop_tasks_enabled === true && (
            <div
              className="rounded-lg border border-gray-200 bg-white p-4"
              data-testid="timebank-balance-coop"
            >
              <p className="text-xs text-gray-500">
                {t('my.balance.coopTask', { month: me.month })}
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {fmt(me.coop_task.received_minutes)}
                <span className="text-sm font-normal text-gray-500">
                  {' '}
                  / {fmt(me.coop_task.cap_minutes)}
                </span>
              </p>
            </div>
          )}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">{t('my.balance.pending')}</p>
            <p className="mt-1 text-sm text-gray-900">
              {t('my.balance.toConfirm', { count: me.pending.to_confirm })}
            </p>
            <p className="text-sm text-gray-900">
              {t('my.balance.awaitingOther', { count: me.pending.awaiting_other })}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
