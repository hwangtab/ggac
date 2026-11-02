'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TIMEBANK_CATEGORIES, TIMEBANK_MEMO_MAX } from '@/constants/timebank'
import {
  TIMEBANK_MINUTE_OPTIONS,
  formatTimebankMinutes,
  timebankFetch,
} from '@/components/timebank/timebankFormat'

type Participant = { id: string; display_name: string }

/**
 * 기록하기(스펙 §5·§8). 일이 끝난 뒤 한 사람이 남기면 상대가 확인한다.
 *
 * - 상대는 `/api/timebank/participants`(현재 판 동의자의 id·표시명만, 자기 자신은
 *   서버가 뺀다)에서 고른다.
 * - 시간은 30분 단위 선택지(30~480)만. 자유 입력은 두지 않는다.
 * - 본문은 `{ counterparty_id, role, minutes, category?, memo? }`뿐이다 — kind·계좌는
 *   서버가 정한다. 거부 사유는 서버 문구 그대로 보인다.
 */
export default function RecordForm({ onRecorded }: { onRecorded: () => void }) {
  const t = useTranslations('timebank')
  const [participants, setParticipants] = useState<Participant[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [role, setRole] = useState<'received' | 'gave'>('received')
  const [counterparty, setCounterparty] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [category, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void timebankFetch<{ participants: Participant[] }>(
      '/api/timebank/participants',
      {},
      t('my.loadError')
    ).then(result => {
      if (!alive) return
      if (result.ok) setParticipants(result.data.participants)
      else setLoadError(result.error)
    })
    return () => {
      alive = false
    }
  }, [t])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!counterparty) return
    setBusy(true)
    setNotice(null)
    const result = await timebankFetch(
      '/api/timebank/transfers',
      {
        method: 'POST',
        json: {
          counterparty_id: counterparty,
          role,
          minutes,
          category: category || null,
          memo: memo.trim() || null,
        },
      },
      t('my.record.error')
    )
    setBusy(false)
    if (result.ok) {
      setNotice({ kind: 'ok', text: t('my.record.done') })
      setMemo('')
      onRecorded()
    } else {
      setNotice({ kind: 'error', text: result.error })
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'

  return (
    <section aria-labelledby="tb-record-heading" data-testid="timebank-record">
      <h2 id="tb-record-heading" className="mb-1 text-lg font-semibold text-gray-900">
        {t('my.record.heading')}
      </h2>
      <p className="mb-3 text-sm text-gray-600">{t('my.record.help')}</p>
      <p className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        {t('scopeNotice')}
      </p>

      {loadError && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {loadError}
        </p>
      )}
      {participants && participants.length === 0 && (
        <p className="mb-3 text-sm text-gray-500">{t('my.record.noParticipants')}</p>
      )}

      <form onSubmit={e => void submit(e)} className="grid gap-4 md:grid-cols-2">
        <fieldset className="md:col-span-2">
          <legend className="text-sm font-medium text-gray-700">{t('my.record.role')}</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            {(['received', 'gave'] as const).map(value => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="tb-role"
                  value={value}
                  checked={role === value}
                  onChange={() => setRole(value)}
                />
                {t(`my.record.role_${value}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="text-sm font-medium text-gray-700">
          {t('my.record.counterparty')}
          <select
            className={field}
            value={counterparty}
            onChange={e => setCounterparty(e.target.value)}
            required
            name="counterparty_id"
          >
            <option value="">{t('my.record.counterpartyPlaceholder')}</option>
            {(participants ?? []).map(p => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-gray-700">
          {t('my.record.minutes')}
          <select
            className={field}
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
            name="minutes"
          >
            {TIMEBANK_MINUTE_OPTIONS.map(m => (
              <option key={m} value={m}>
                {formatTimebankMinutes(t, m)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-gray-700">
          {t('form.category')}
          <select
            className={field}
            value={category}
            onChange={e => setCategory(e.target.value)}
            name="category"
          >
            <option value="">{t('my.record.categoryNone')}</option>
            {TIMEBANK_CATEGORIES.map(c => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-gray-700">
          {t('my.record.memo')}
          <input
            className={field}
            value={memo}
            onChange={e => setMemo(e.target.value)}
            maxLength={TIMEBANK_MEMO_MAX}
            placeholder={t('my.record.memoPlaceholder')}
            name="memo"
          />
        </label>

        <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
          {notice ? (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm ${notice.kind === 'error' ? 'text-red-700' : 'text-green-800'}`}
            >
              {notice.text}
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={busy || !counterparty}
            className="rounded-lg bg-primary-600 px-5 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? t('my.record.submitting') : t('my.record.submit')}
          </button>
        </div>
      </form>
    </section>
  )
}
