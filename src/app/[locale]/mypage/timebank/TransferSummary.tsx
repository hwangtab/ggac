'use client'

import { useTranslations } from 'next-intl'
import type { MyTransferView } from '@/lib/timebank/format'
import { formatTimebankDateTime, formatTimebankMinutes } from '@/components/timebank/timebankFormat'

export type { MyTransferView }

/**
 * 원장 행 한 줄(본인 시점) — 방향·시간·종류·상대·분류·메모·시각. 확인 대기와 내역이
 * 같이 쓴다. 조합 계좌가 상대면(`counterparty.id === null`) 로케일 문구로 "조합"을 쓴다.
 */
export default function TransferSummary({ row }: { row: MyTransferView }) {
  const t = useTranslations('timebank')
  const counterparty = row.counterparty.id === null ? t('my.coop') : row.counterparty.name || '—'
  const sign = row.direction === 'in' ? '+' : '−'
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`font-semibold ${row.direction === 'in' ? 'text-green-700' : 'text-red-700'}`}
        >
          {sign}
          {formatTimebankMinutes(t, row.minutes)}
        </span>
        <span className="text-sm text-gray-900">
          {row.direction === 'in'
            ? t('my.fromCounterparty', { name: counterparty })
            : t('my.toCounterparty', { name: counterparty })}
        </span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
          {t(`transferKind.${row.kind}`)}
        </span>
        {row.category && (
          <span className="text-xs text-gray-500">{t(`category.${row.category}`)}</span>
        )}
      </div>
      {row.memo && <p className="mt-1 break-words text-sm text-gray-600">{row.memo}</p>}
      <p className="mt-1 text-xs text-gray-500">
        {formatTimebankDateTime(row.happened_at)}
        {row.recorded_by_me && row.kind !== 'coop_task' ? ` · ${t('my.recordedByMe')}` : ''}
      </p>
    </div>
  )
}
