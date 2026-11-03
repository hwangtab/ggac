import {
  SETTING_LABELS,
  describeSettingValue,
  fmtKst,
  type SettingsHistoryRow,
  type TimebankSettings,
} from '@/components/timebank/timebankAdminFormat'

type Key = keyof TimebankSettings

/**
 * 타임뱅크 설정 변경 이력 — 언제·누가·의결 근거·바뀐 칸(스펙 §9.2). 관리자 설정
 * 화면과 이사회 보고 화면이 같이 쓴다.
 */
export default function TimebankSettingsHistory({ history }: { history: SettingsHistoryRow[] }) {
  if (history.length === 0) return <p className="text-sm text-gray-500">이력이 없습니다.</p>
  return (
    <ul className="space-y-2">
      {history.map(row => {
        const before = (row.old_value ?? {}) as Partial<TimebankSettings>
        const after = (row.new_value ?? {}) as Partial<TimebankSettings>
        const keys = (Object.keys(SETTING_LABELS) as Key[]).filter(k => before[k] !== after[k])
        return (
          <li key={row.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <p className="text-gray-900">
              {fmtKst(row.changed_at)} · {row.changed_by_name || '—'}
            </p>
            <p className="mt-1 text-gray-700">근거: {row.change_reason || '(기록 없음)'}</p>
            {keys.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                {keys.map(k => (
                  <li key={k}>
                    {SETTING_LABELS[k]}: {describeSettingValue(k, before[k])} →{' '}
                    {describeSettingValue(k, after[k])}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
