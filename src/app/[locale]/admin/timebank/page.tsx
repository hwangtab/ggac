'use client'

import { useCallback, useEffect, useState } from 'react'
import { FiRefreshCw } from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import { timebankFetch } from '@/components/timebank/timebankFormat'
import { fetchSessionProfile } from '@/utils/sessionProfile'
import AccountsPanel from './AccountsPanel'
import CoopTasksPanel from './CoopTasksPanel'
import AdjustPanel from './AdjustPanel'
import SettingsPanel from './SettingsPanel'
import type {
  AccountsResponse,
  SettingsHistoryRow,
  TimebankSettings,
} from '@/components/timebank/timebankAdminFormat'

type SettingsResponse = {
  settings: TimebankSettings
  has_row: boolean
  history: SettingsHistoryRow[]
}

const TABS = [
  { key: 'accounts', label: '잔액·대기·승인' },
  { key: 'tasks', label: '조합 업무' },
  { key: 'adjust', label: '조정' },
  { key: 'settings', label: '설정·이력' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * 관리자 타임뱅크(스펙 §7.3·§9.2). 경로는 미들웨어가 관리자만 들이고, 모든 쓰기는
 * `/api/admin/timebank/*`(`auth: 'admin'`)가 다시 판정한다.
 *
 * 교환권 예매·교환소 주문 관리(스펙 §13)는 1-B라 여기 없다.
 */
export default function AdminTimebankPage() {
  const [tab, setTab] = useState<TabKey>('accounts')
  const [myId, setMyId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null)
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [a, s] = await Promise.all([
      timebankFetch<AccountsResponse>(
        '/api/admin/timebank/accounts',
        {},
        '잔액표를 불러오지 못했습니다.'
      ),
      timebankFetch<SettingsResponse>(
        '/api/admin/timebank/settings',
        {},
        '타임뱅크 설정을 불러오지 못했습니다.'
      ),
    ])
    setLoading(false)
    if (a.ok) setAccounts(a.data)
    if (s.ok) setSettings(s.data)
    const failures = [a, s].filter(r => !r.ok).map(r => r.error)
    setError(failures.length > 0 ? failures.join(' ') : null)
  }, [])

  useEffect(() => {
    void load()
    void fetchSessionProfile().then(session => setMyId(session.user?.id ?? null))
  }, [load])

  const coopOpen =
    settings?.settings.enabled === true && settings?.settings.coop_tasks_enabled === true

  return (
    <AdminLayout
      title="타임뱅크"
      description="잔액표·대기·조합 업무 지급·조정·설정. 모든 쓰기는 활동 기록과 보안 로그에 남습니다."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              tab === item.key
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {item.label}
            {item.key === 'accounts' && accounts && accounts.pending_adjustments.length > 0
              ? ` (${accounts.pending_adjustments.length})`
              : ''}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          <FiRefreshCw className={loading ? 'animate-spin' : ''} /> 새로 고침
        </button>
      </div>

      {settings && (
        <p className="mb-4 text-sm text-gray-600">
          타임뱅크 {settings.settings.enabled ? '켜짐' : '꺼짐'} · 조합 업무{' '}
          {coopOpen ? '켜짐' : '꺼짐'} · 이용규칙 {settings.settings.terms_version} 판
        </p>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {tab === 'accounts' && accounts && (
        <AccountsPanel data={accounts} myId={myId} onChanged={() => void load()} />
      )}
      {tab === 'tasks' && (
        <CoopTasksPanel open={coopOpen} myId={myId} onChanged={() => void load()} />
      )}
      {tab === 'adjust' && (
        <AdjustPanel
          accounts={accounts?.accounts ?? []}
          dualApprovalMinutes={settings?.settings.adjustment_dual_approval_minutes ?? null}
          myId={myId}
          onChanged={() => void load()}
        />
      )}
      {tab === 'settings' && saved && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {saved}
        </p>
      )}
      {tab === 'settings' && settings && (
        <SettingsPanel
          key={JSON.stringify(settings.settings)}
          settings={settings.settings}
          hasRow={settings.has_row}
          history={settings.history}
          onSaved={message => {
            setSaved(message)
            void load()
          }}
        />
      )}
    </AdminLayout>
  )
}
