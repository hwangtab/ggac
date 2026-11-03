'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  TIMEBANK_CATEGORIES,
  TIMEBANK_DESCRIPTION_MAX,
  TIMEBANK_TITLE_MAX,
  type TimebankCategory,
} from '@/constants/timebank'
import { MEMBER_LISTING_KINDS, type MemberListingKind } from '@/lib/timebank/validate'
import {
  TIMEBANK_ESTIMATE_OPTIONS,
  formatTimebankMinutes,
} from '@/components/timebank/timebankFormat'

export interface TimebankListingFormInitial {
  id: string
  kind: MemberListingKind
  category: TimebankCategory
  title: string
  description: string
  estimated_minutes: number | null
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

/**
 * 제공·요청 글쓰기·수정. 조합 업무(`coop_task`)는 관리자 화면에서만 올린다 — 여기는
 * 고를 수 없다(`POST /api/timebank/listings`도 거부한다). 맨 위에 이용 범위 고정
 * 안내(스펙 §4)를 둔다.
 */
export default function TimebankListingForm({ initial }: { initial?: TimebankListingFormInitial }) {
  const t = useTranslations('timebank')
  const router = useRouter()

  const [kind, setKind] = useState<MemberListingKind>(initial?.kind ?? 'offer')
  const [category, setCategory] = useState<TimebankCategory>(initial?.category ?? 'lesson')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [estimated, setEstimated] = useState(
    initial?.estimated_minutes ? String(initial.estimated_minutes) : ''
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(
        initial ? `/api/timebank/listings/${initial.id}` : '/api/timebank/listings',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            category,
            title,
            description,
            estimated_minutes: estimated ? Number(estimated) : null,
          }),
        }
      )
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        setError(json?.error || t('form.error'))
        return
      }
      const id = json?.data?.id ?? initial?.id
      router.push(`/board/timebank/${id}`)
      router.refresh()
    } catch {
      setError(t('form.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg bg-white p-6 shadow-sm">
      <p
        data-testid="timebank-scope-notice"
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        {t('scopeNotice')}
      </p>

      <div>
        <span className="mb-2 block text-sm font-medium text-gray-700">{t('form.kind')}</span>
        <div className="flex gap-2">
          {MEMBER_LISTING_KINDS.map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={`rounded-lg border px-4 py-2 text-sm ${
                kind === value
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700'
              }`}
            >
              {t(`kind.${value}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">{t('form.title')}</span>
        <input
          className={inputClass}
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={TIMEBANK_TITLE_MAX}
          placeholder={t('form.titlePlaceholder')}
          required
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('form.category')}</span>
          <select
            className={inputClass}
            value={category}
            onChange={e => setCategory(e.target.value as TimebankCategory)}
          >
            {TIMEBANK_CATEGORIES.map(value => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('form.estimated')}
          </span>
          <select
            className={inputClass}
            value={estimated}
            onChange={e => setEstimated(e.target.value)}
          >
            <option value="">{t('form.estimatedNone')}</option>
            {TIMEBANK_ESTIMATE_OPTIONS.map(minutes => (
              <option key={minutes} value={String(minutes)}>
                {formatTimebankMinutes(t, minutes)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          {t('form.description')}
        </span>
        <textarea
          className={`${inputClass} min-h-40`}
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={TIMEBANK_DESCRIPTION_MAX}
          placeholder={t('form.descriptionPlaceholder')}
          required
        />
        <span className="mt-1 block text-xs text-amber-700">{t('form.contactWarning')}</span>
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700"
        >
          {t('form.cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {submitting ? t('form.submitting') : initial ? t('form.save') : t('form.submit')}
        </button>
      </div>
    </form>
  )
}
