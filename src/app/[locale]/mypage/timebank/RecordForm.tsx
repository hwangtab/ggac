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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 기록하기(스펙 §5·§8). 일이 끝난 뒤 한 사람이 남기면 상대가 확인한다.
 *
 * - 상대는 `/api/timebank/participants`(현재 판 동의자의 id·표시명만, 자기 자신은
 *   서버가 뺀다)에서 고른다.
 * - 시간은 30분 단위 선택지(30~480)만. 자유 입력은 두지 않는다.
 * - 본문은 `{ counterparty_id, role, minutes, category?, memo?, listing_id? }`뿐이다 —
 *   kind·계좌는 서버가 정한다. 거부 사유는 서버 문구 그대로 보인다.
 * - 게시판 글의 "이 글로 기록하기"는 `?with=<상대>&listing=<글>&category=<분류>&role=`로
 *   들어온다. 상대가 참여자 명단에 있을 때만 미리 고른다(값은 서버가 다시 판정한다).
 * - 제출 전에 "저장하면 시간이 어디로 가는지"를 한 줄로 보인다 — "도움을 받았다"와
 *   "시간을 준다"가 같은 일이라는 것을 기록하는 순간에 보여 준다.
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
  const [listingId, setListingId] = useState<string | null>(null)
  const [prefillWith, setPrefillWith] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 게시판 글에서 넘어온 값. 주소창 값이라 형식만 거르고, 판정은 서버가 한다.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const withId = q.get('with')
    if (withId && UUID_RE.test(withId)) setPrefillWith(withId)
    const listing = q.get('listing')
    if (listing && UUID_RE.test(listing)) setListingId(listing)
    const cat = q.get('category')
    if (cat && (TIMEBANK_CATEGORIES as readonly string[]).includes(cat)) setCategory(cat)
    const r = q.get('role')
    if (r === 'received' || r === 'gave') setRole(r)
  }, [])

  useEffect(() => {
    if (prefillWith && participants?.some(p => p.id === prefillWith)) setCounterparty(prefillWith)
  }, [prefillWith, participants])

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
          ...(listingId && counterparty === prefillWith ? { listing_id: listingId } : {}),
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

  const counterpartyName = participants?.find(p => p.id === counterparty)?.display_name ?? null
  const field = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'

  return (
    <section
      id="record"
      aria-labelledby="tb-record-heading"
      data-testid="timebank-record"
      className="scroll-mt-24"
    >
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

        {/* 안내는 placeholder에 다 담지 않는다 — 좁은 화면(375px)에서 잘린다. */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('my.record.memo')}
            <input
              className={field}
              value={memo}
              onChange={e => setMemo(e.target.value)}
              maxLength={TIMEBANK_MEMO_MAX}
              placeholder={t('my.record.memoPlaceholder')}
              name="memo"
              aria-describedby="tb-record-memo-help"
            />
          </label>
          <p id="tb-record-memo-help" className="mt-1 text-xs text-gray-500">
            {t('my.record.memoHelp')}
          </p>
        </div>

        {counterpartyName && (
          <p
            className="md:col-span-2 rounded-lg bg-primary-50 p-3 text-sm text-primary-800"
            data-testid="timebank-record-preview"
          >
            {role === 'received'
              ? t('my.record.previewReceived', {
                  name: counterpartyName,
                  time: formatTimebankMinutes(t, minutes),
                })
              : t('my.record.previewGave', {
                  name: counterpartyName,
                  time: formatTimebankMinutes(t, minutes),
                })}
          </p>
        )}

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
