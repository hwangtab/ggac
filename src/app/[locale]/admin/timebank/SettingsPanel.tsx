'use client'

import { useMemo, useState } from 'react'
import { timebankFetch } from '@/components/timebank/timebankFormat'
import TimebankSettingsHistory from '@/components/timebank/TimebankSettingsHistory'
import {
  SETTING_LABELS,
  describeSettingValue,
  fmtMinutes,
  type SettingsHistoryRow,
  type TimebankSettings,
} from '@/components/timebank/timebankAdminFormat'

type Key = keyof TimebankSettings

/** 이 화면에서 바꾸는 스위치. 1-B 채널 스위치는 그 화면이 생길 때 연다(읽기만). */
const EDITABLE_SWITCHES: Key[] = ['enabled', 'coop_tasks_enabled']
const LATER_SWITCHES: Key[] = [
  'redeem_tickets_enabled',
  'redeem_rewards_enabled',
  'market_time_enabled',
]
/** 이용규칙의 "수치" — 바꾸면 `terms_version`도 바꿔야 한다(서버 `planTimebankSettingsChange`). */
const NUMERIC_KEYS: Key[] = [
  'signup_grant_minutes',
  'min_balance_minutes',
  'soft_max_minutes',
  'low_balance_flag_minutes',
  'coop_task_monthly_cap_minutes',
  'adjustment_dual_approval_minutes',
  'redeem_monthly_cap_minutes',
  'market_item_max_minutes',
]
/** 하한류는 −1200~0, 나머지는 0~2400(`normalizeTimebankSettings`). */
const FLOOR_KEYS: Key[] = ['min_balance_minutes', 'low_balance_flag_minutes']
const RESOLUTION_REF_MIN = 5
const RESOLUTION_REF_MAX = 200

function changedKeys(a: TimebankSettings, b: TimebankSettings): Key[] {
  return (Object.keys(SETTING_LABELS) as Key[]).filter(k => a[k] !== b[k])
}

/**
 * 타임뱅크 설정(스펙 §9.1·§9.2). 수치와 스위치는 이사회가 의결한 이용규칙의 내용이라
 * **의결 근거(이사회 일자·안건)**가 없으면 저장하지 않는다. 수치를 바꾸면 이용규칙 판도
 * 올려야 한다 — 화면이 먼저 막고, 서버(`PUT /api/admin/timebank/settings`)가 다시 본다.
 * 서버가 거부하면 그 문구를 그대로 보인다. 아래에 변경 이력(근거 포함)을 둔다.
 */
export default function SettingsPanel({
  settings,
  hasRow,
  history,
  onSaved,
}: {
  settings: TimebankSettings
  hasRow: boolean
  history: SettingsHistoryRow[]
  /** 저장 뒤 부모가 설정을 다시 읽는다(이 패널은 새 값으로 다시 그려진다). 문구는 부모가 보인다. */
  onSaved: (message: string) => void
}) {
  const [draft, setDraft] = useState<TimebankSettings>(settings)
  const [resolutionRef, setResolutionRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const changed = useMemo(() => changedKeys(settings, draft), [settings, draft])
  const numericChanged = changed.some(k => NUMERIC_KEYS.includes(k))
  const termsBumped = draft.terms_version.trim() !== settings.terms_version
  const refLength = resolutionRef.trim().length
  const refOk = refLength >= RESOLUTION_REF_MIN && refLength <= RESOLUTION_REF_MAX
  const needsBump = numericChanged && !termsBumped
  const canSave = hasRow && changed.length > 0 && refOk && !needsBump && !busy

  const set = <K extends Key>(key: K, value: TimebankSettings[K]) =>
    setDraft(d => ({ ...d, [key]: value }))

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const patch = Object.fromEntries(changed.map(k => [k, draft[k]]))
    const result = await timebankFetch<{ changed: Key[] }>(
      '/api/admin/timebank/settings',
      { method: 'PUT', json: { settings: patch, resolution_ref: resolutionRef } },
      '타임뱅크 설정을 바꾸지 못했습니다.'
    )
    setBusy(false)
    if (result.ok) {
      setResolutionRef('')
      onSaved(result.message ?? '타임뱅크 설정을 바꿨습니다.')
    } else setNotice({ kind: 'error', text: result.error })
  }

  const field = 'mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm'

  return (
    <div className="space-y-8">
      <section aria-labelledby="adm-settings" data-testid="admin-timebank-settings">
        <h2 id="adm-settings" className="mb-2 text-lg font-semibold text-gray-900">
          설정
        </h2>
        <p className="mb-3 text-sm text-gray-600">
          이 값들은 이사회가 의결한 이용규칙의 내용입니다. 바꿀 때는 의결 근거를 적어야 하고, 근거는
          변경 이력과 이사회 보고 화면에 남습니다. 수치를 바꾸면 이용규칙 판도 올려야 하며, 판이
          바뀌면 참여자는 새 판에 다시 동의해야 기록·확인을 할 수 있습니다.
        </p>
        {!hasRow && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            타임뱅크 설정 행이 없습니다. 시드 스크립트(scripts/turso/seed-timebank-settings.mjs)를
            먼저 실행해야 저장할 수 있습니다.
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

        {/* noValidate: 범위·단위 검사는 서버(`planTimebankSettingsChange`)가 하고 그 문구를 그대로 보인다. */}
        <form onSubmit={e => void save(e)} className="space-y-5" noValidate>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700">스위치</legend>
            {EDITABLE_SWITCHES.map(key => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={draft[key] === true}
                  onChange={e => set(key, e.target.checked as never)}
                />
                {SETTING_LABELS[key]}
              </label>
            ))}
            <p className="text-xs text-gray-500">
              {LATER_SWITCHES.map(
                k => `${SETTING_LABELS[k]}: ${describeSettingValue(k, draft[k])}`
              ).join(' · ')}{' '}
              — 1-B 단계에서 화면과 함께 엽니다.
            </p>
          </fieldset>

          <div className="grid gap-3 md:grid-cols-2">
            {NUMERIC_KEYS.map(key => {
              const floor = FLOOR_KEYS.includes(key)
              const value = draft[key] as number
              return (
                <label key={key} className="text-sm font-medium text-gray-700">
                  {SETTING_LABELS[key]}
                  <input
                    type="number"
                    step={30}
                    min={floor ? -1200 : 0}
                    max={floor ? 0 : 2400}
                    className={field}
                    value={Number.isFinite(value) ? value : ''}
                    onChange={e => set(key, Number(e.target.value) as never)}
                  />
                  <span className="text-xs font-normal text-gray-500">
                    {fmtMinutes(value)} · 30분 단위, {floor ? '−1200~0' : '0~2400'}
                  </span>
                </label>
              )
            })}
          </div>

          <label className="block text-sm font-medium text-gray-700">
            {SETTING_LABELS.terms_version}
            <input
              className={field}
              value={draft.terms_version}
              onChange={e => set('terms_version', e.target.value)}
              maxLength={32}
            />
            {needsBump && (
              <span className="mt-1 block text-xs font-normal text-red-700" role="alert">
                수치를 바꾸면 이용규칙 판도 올려야 합니다(지금 판 {settings.terms_version}). 새 판의
                이용규칙 본문이 준비되어 있어야 참여자가 동의할 수 있습니다.
              </span>
            )}
          </label>

          <label className="block text-sm font-medium text-gray-700">
            의결 근거(이사회 일자·안건, 필수 {RESOLUTION_REF_MIN}~{RESOLUTION_REF_MAX}자)
            <input
              className={field}
              value={resolutionRef}
              onChange={e => setResolutionRef(e.target.value)}
              maxLength={RESOLUTION_REF_MAX}
              placeholder="예: 2026-11-20 제3차 이사회 안건 2 의결"
              data-testid="admin-timebank-resolution-ref"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-600">
              {changed.length === 0
                ? '바뀐 값이 없습니다.'
                : `바뀌는 값: ${changed.map(k => SETTING_LABELS[k]).join(', ')}`}
            </p>
            <button
              type="submit"
              disabled={!canSave}
              className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? '저장하는 중…' : '의결 근거와 함께 저장'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="adm-settings-history" data-testid="admin-timebank-settings-history">
        <h2 id="adm-settings-history" className="mb-2 text-lg font-semibold text-gray-900">
          변경 이력
        </h2>
        <TimebankSettingsHistory history={history} />
      </section>
    </div>
  )
}
