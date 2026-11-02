'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  TIMEBANK_CATEGORIES,
  TIMEBANK_PROFILE_TEXT_MAX,
  type TimebankCategory,
} from '@/constants/timebank'
import { timebankFetch } from '@/components/timebank/timebankFormat'

type Profile = {
  offers: string
  needs: string
  categories: TimebankCategory[]
  visible: boolean
}

/**
 * 프로필(스펙 §8): 줄 수 있는 것·필요한 것, 분류, 디렉터리 공개. 읽기는 언제나
 * (`GET /api/timebank/profile`), 저장은 참여 자격이 있을 때만(`PATCH`).
 */
export default function ProfilePanel({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('timebank')
  const [profile, setProfile] = useState<Profile>({
    offers: '',
    needs: '',
    categories: [],
    visible: false,
  })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void timebankFetch<{ profile: Profile | null }>(
      '/api/timebank/profile',
      {},
      t('my.loadError')
    ).then(result => {
      if (!alive) return
      if (result.ok && result.data.profile) {
        const p = result.data.profile
        setProfile({
          offers: p.offers ?? '',
          needs: p.needs ?? '',
          categories: Array.isArray(p.categories) ? p.categories : [],
          visible: p.visible === true,
        })
      } else if (!result.ok) {
        setNotice({ kind: 'error', text: result.error })
      }
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [t])

  const toggleCategory = (c: TimebankCategory) =>
    setProfile(p => ({
      ...p,
      categories: p.categories.includes(c)
        ? p.categories.filter(x => x !== c)
        : [...p.categories, c],
    }))

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const result = await timebankFetch(
      '/api/timebank/profile',
      { method: 'PATCH', json: profile },
      t('my.profile.error')
    )
    setBusy(false)
    setNotice(
      result.ok
        ? { kind: 'ok', text: t('my.profile.saved') }
        : { kind: 'error', text: result.error }
    )
  }

  const field =
    'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50'

  return (
    <section aria-labelledby="tb-profile-heading" data-testid="timebank-profile">
      <h2 id="tb-profile-heading" className="mb-1 text-lg font-semibold text-gray-900">
        {t('my.profile.heading')}
      </h2>
      {!canEdit && <p className="mb-3 text-sm text-gray-500">{t('my.profile.readOnly')}</p>}
      <form onSubmit={e => void save(e)} className="space-y-4">
        <label className="block text-sm font-medium text-gray-700">
          {t('my.profile.offers')}
          <textarea
            className={field}
            rows={3}
            value={profile.offers}
            maxLength={TIMEBANK_PROFILE_TEXT_MAX}
            disabled={!canEdit || !loaded}
            onChange={e => setProfile(p => ({ ...p, offers: e.target.value }))}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('my.profile.needs')}
          <textarea
            className={field}
            rows={3}
            value={profile.needs}
            maxLength={TIMEBANK_PROFILE_TEXT_MAX}
            disabled={!canEdit || !loaded}
            onChange={e => setProfile(p => ({ ...p, needs: e.target.value }))}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-gray-700">{t('form.category')}</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {TIMEBANK_CATEGORIES.map(c => (
              <label key={c} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={profile.categories.includes(c)}
                  disabled={!canEdit || !loaded}
                  onChange={() => toggleCategory(c)}
                />
                {t(`category.${c}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={profile.visible}
            disabled={!canEdit || !loaded}
            onChange={e => setProfile(p => ({ ...p, visible: e.target.checked }))}
          />
          <span>
            {t('my.profile.visible')}
            <span className="block text-xs text-gray-500">{t('my.profile.visibleHelp')}</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          {canEdit && (
            <button
              type="submit"
              disabled={busy || !loaded}
              className="rounded-lg bg-primary-600 px-5 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? t('my.profile.saving') : t('my.profile.save')}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
