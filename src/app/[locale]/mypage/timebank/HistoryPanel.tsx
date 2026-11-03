'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  currentKstMonth,
  formatTimebankMinutes,
  timebankFetch,
} from '@/components/timebank/timebankFormat'
import TransferSummary, { type MyTransferView } from './TransferSummary'

/**
 * 내역 채널 필터. 1-A에 있는 채널만 보인다 — 장터(`market`)·조합 서비스(`service`,
 * 교환권·교환소)는 1-B에서 연다(서버 `TIMEBANK_CHANNELS`에는 이미 있다).
 */
const CHANNELS = ['exchange', 'reversal', 'coop_task', 'signup', 'adjustment'] as const

type HistoryResponse = {
  page: number
  has_next: boolean
  totals: { received_minutes: number; given_minutes: number } | null
  transfers: MyTransferView[]
}

/**
 * 내역(스펙 §8): 채널·KST 월 필터, 그 달 받은/준 합계(서버 `totals`), 페이지.
 * 행에서 "되돌리기 요청"(확정된 교환, 서버의 `can_reverse`) → `reversal` 기록(상대
 * 확인). 관련 글이 있으면 행에서 글로 간다. CSV는 고른 달(전체면 이번 달)을 받는다.
 *
 * 누구의 내역인지는 서버가 세션으로 정한다 — 이 화면은 회원 id를 보내지 않는다.
 */
export default function HistoryPanel({
  refreshKey,
  canRecord,
  coopTasksEnabled,
  onChanged,
}: {
  refreshKey: number
  /** 되돌리기 요청은 새 기록이라 참여 자격이 있어야 한다. */
  canRecord: boolean
  /** 꺼져 있으면 필터에서 조합 업무를 뺀다(게시판·마이페이지의 다른 조합 업무 화면과 같다). */
  coopTasksEnabled: boolean
  onChanged: () => void
}) {
  const t = useTranslations('timebank')
  const [channel, setChannel] = useState<string>('')
  const [month, setMonth] = useState<string>(() => currentKstMonth())
  const [page, setPage] = useState(1)
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    const params = new URLSearchParams()
    if (channel) params.set('channel', channel)
    if (month) params.set('month', month)
    if (page > 1) params.set('page', String(page))
    void timebankFetch<HistoryResponse>(
      `/api/timebank/me/transfers?${params.toString()}`,
      {},
      t('my.loadError')
    ).then(result => {
      if (!alive) return
      if (result.ok) {
        setData(result.data)
        setLoadError(null)
      } else setLoadError(result.error)
    })
    return () => {
      alive = false
    }
  }, [channel, month, page, refreshKey, t])

  const reverse = async (row: MyTransferView) => {
    if (!row.counterparty.id) return
    if (!window.confirm(t('my.history.reverseConfirm'))) return
    setBusyId(row.id)
    setNotice(null)
    const result = await timebankFetch(
      '/api/timebank/transfers',
      {
        method: 'POST',
        json: { counterparty_id: row.counterparty.id, reverses_id: row.id, minutes: row.minutes },
      },
      t('my.actionError')
    )
    setBusyId(null)
    if (result.ok) {
      setNotice({ kind: 'ok', text: t('my.history.reverseDone') })
      onChanged()
    } else setNotice({ kind: 'error', text: result.error })
  }

  const csvMonth = month || currentKstMonth()
  const fmt = (minutes: number) => formatTimebankMinutes(t, minutes)
  const field = 'mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm'

  return (
    <section aria-labelledby="tb-history-heading" data-testid="timebank-history">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="tb-history-heading" className="text-lg font-semibold text-gray-900">
          {t('my.history.heading')}
        </h2>
        <a
          href={`/api/timebank/me/transfers.csv?month=${encodeURIComponent(csvMonth)}`}
          download={`timebank-${csvMonth}.csv`}
          data-testid="timebank-csv"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          {t('my.history.csv', { month: csvMonth })}
        </a>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          {t('my.history.channel')}
          <select
            className={`${field} block`}
            value={channel}
            onChange={e => {
              setChannel(e.target.value)
              setPage(1)
            }}
            name="channel"
          >
            <option value="">{t('my.history.channelAll')}</option>
            {CHANNELS.filter(c => coopTasksEnabled || c !== 'coop_task').map(c => (
              <option key={c} value={c}>
                {t(`my.history.channels.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          {t('my.history.month')}
          <input
            type="month"
            className={`${field} block`}
            value={month}
            onChange={e => {
              setMonth(e.target.value)
              setPage(1)
            }}
            name="month"
          />
        </label>
        {month && (
          <button
            type="button"
            onClick={() => {
              setMonth('')
              setPage(1)
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('my.history.allMonths')}
          </button>
        )}
      </div>

      {data?.totals && month && (
        <p className="mb-3 text-sm text-gray-700" data-testid="timebank-month-totals">
          {t('my.history.totals', {
            month,
            received: fmt(data.totals.received_minutes),
            given: fmt(data.totals.given_minutes),
          })}
        </p>
      )}

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mb-3 rounded-lg p-3 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}
        >
          {notice.text}
        </p>
      )}
      {loadError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {data && data.transfers.length === 0 && (
        <p className="py-6 text-center text-sm text-gray-500">{t('my.history.empty')}</p>
      )}
      {data && data.transfers.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {data.transfers.map(row => (
            <li
              key={row.id}
              data-testid="timebank-history-row"
              data-kind={row.kind}
              data-status={row.status}
              className="flex flex-wrap items-start gap-3 p-3"
            >
              <TransferSummary row={row} />
              <div className="flex flex-col items-end gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    row.status === 'confirmed'
                      ? 'bg-green-100 text-green-800'
                      : row.status === 'pending'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {t(`transferStatus.${row.status}`)}
                </span>
                {row.ref_type === 'listing' && row.ref_id && (
                  <Link
                    href={`/board/timebank/${row.ref_id}`}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    {t('my.history.relatedPost')}
                  </Link>
                )}
                {canRecord && row.can_reverse && row.counterparty.id && (
                  <button
                    type="button"
                    onClick={() => void reverse(row)}
                    disabled={busyId === row.id}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {t('my.history.reverse')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && (page > 1 || data.has_next) && (
        <div className="mt-4 flex justify-center gap-4 text-sm">
          {page > 1 && (
            <button type="button" onClick={() => setPage(p => p - 1)} className="text-primary-600">
              {t('pagination.prev')}
            </button>
          )}
          {data.has_next && (
            <button type="button" onClick={() => setPage(p => p + 1)} className="text-primary-600">
              {t('pagination.next')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
