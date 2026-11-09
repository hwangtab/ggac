'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { timebankFetch } from '@/components/timebank/timebankFormat'
import TransferSummary, { type MyTransferView } from './TransferSummary'

type PendingResponse = { to_confirm: MyTransferView[]; awaiting_other: MyTransferView[] }

/**
 * 확인 대기(스펙 §8): 내가 확인할 기록(확인·거절)과 내가 남긴 기록(취소). 7일 넘은
 * 건은 표시한다.
 *
 * 확인은 참여 자격이 있을 때만 단추를 보인다(`canConfirm`). 거절·취소는 꺼짐·구판
 * 동의·탈퇴 신청 중에도 된다(§7.2 — 대기를 줄이는 동작). 실패 사유는 서버 문구
 * (`describeLedgerError`)를 그대로 보인다.
 */
export default function PendingPanel({
  refreshKey,
  canConfirm,
  onChanged,
}: {
  refreshKey: number
  canConfirm: boolean
  onChanged: () => void
}) {
  const t = useTranslations('timebank')
  const [data, setData] = useState<PendingResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void timebankFetch<PendingResponse>('/api/timebank/me/pending', {}, t('my.loadError')).then(
      result => {
        if (!alive) return
        if (result.ok) {
          setData(result.data)
          setLoadError(null)
        } else setLoadError(result.error)
      }
    )
    return () => {
      alive = false
    }
  }, [refreshKey, t])

  const act = async (row: MyTransferView, action: 'confirm' | 'reject' | 'cancel') => {
    if (action !== 'confirm' && !window.confirm(t(`my.pending.${action}Confirm`))) return
    setBusyId(row.id)
    setNotice(null)
    const result = await timebankFetch<{ transfer: MyTransferView }>(
      `/api/timebank/transfers/${row.id}/${action}`,
      { method: 'POST' },
      t('my.actionError')
    )
    setBusyId(null)
    if (result.ok) {
      setNotice({ kind: 'ok', text: result.message ?? t(`my.pending.${action}Done`) })
      onChanged()
    } else {
      setNotice({ kind: 'error', text: result.error })
    }
  }

  const staleBadge = (row: MyTransferView) =>
    row.stale ? (
      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
        {t('my.pending.stale')}
      </span>
    ) : null

  const button = (label: string, onClick: () => void, tone: 'primary' | 'plain', busy: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        tone === 'primary'
          ? 'rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50'
          : 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'
      }
    >
      {label}
    </button>
  )

  return (
    <section
      id="pending"
      aria-labelledby="tb-pending-heading"
      data-testid="timebank-pending"
      className="scroll-mt-24"
    >
      <h2 id="tb-pending-heading" className="mb-3 text-lg font-semibold text-gray-900">
        {t('my.pending.heading')}
      </h2>
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
      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">{t('my.pending.toConfirm')}</h3>
            {data.to_confirm.length === 0 ? (
              <p className="text-sm text-gray-500">{t('my.pending.emptyToConfirm')}</p>
            ) : (
              <ul className="space-y-2">
                {data.to_confirm.map(row => (
                  <li
                    key={row.id}
                    data-testid="timebank-to-confirm"
                    className="rounded-lg border border-gray-200 p-3"
                  >
                    <div className="flex items-start">
                      <TransferSummary row={row} />
                      {staleBadge(row)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canConfirm &&
                        row.can_confirm &&
                        button(
                          t('my.pending.confirm'),
                          () => void act(row, 'confirm'),
                          'primary',
                          busyId === row.id
                        )}
                      {row.can_reject &&
                        button(
                          t('my.pending.reject'),
                          () => void act(row, 'reject'),
                          'plain',
                          busyId === row.id
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              {t('my.pending.awaitingOther')}
            </h3>
            {data.awaiting_other.length === 0 ? (
              <p className="text-sm text-gray-500">{t('my.pending.emptyAwaiting')}</p>
            ) : (
              <ul className="space-y-2">
                {data.awaiting_other.map(row => (
                  <li
                    key={row.id}
                    data-testid="timebank-awaiting"
                    className="rounded-lg border border-gray-200 p-3"
                  >
                    <div className="flex items-start">
                      <TransferSummary row={row} />
                      {staleBadge(row)}
                    </div>
                    {row.can_cancel && (
                      <div className="mt-2">
                        {button(
                          t('my.pending.cancel'),
                          () => void act(row, 'cancel'),
                          'plain',
                          busyId === row.id
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
