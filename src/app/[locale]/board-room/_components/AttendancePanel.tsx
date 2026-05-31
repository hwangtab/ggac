'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

interface RosterMember {
  id: string
  display_name: string
  director_title: string | null
}

interface Attendee {
  member_id: string
  attended: boolean
}

interface Quorum {
  total: number
  required: number
  attended: number
  met: boolean
}

interface AttendancePanelProps {
  roster: RosterMember[]
  auditors?: RosterMember[]
  attendees: Attendee[]
  quorum: Quorum
  meetingId: string
  isAdmin: boolean
  onChanged: () => void
}

export default function AttendancePanel({
  roster,
  auditors = [],
  attendees,
  quorum,
  meetingId,
  isAdmin,
  onChanged,
}: AttendancePanelProps) {
  const t = useTranslations('boardRoom.detail')

  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 이사 + 감사 모두 출석 체크 대상 (단, 정족수는 이사만 산정 — 서버에서 처리)
  const allMembers = [...roster, ...auditors]

  // Seed checkboxes from attendees prop whenever it changes
  useEffect(() => {
    const initial: Record<string, boolean> = {}
    allMembers.forEach(m => {
      const found = attendees.find(a => a.member_id === m.id)
      initial[m.id] = found ? found.attended : false
    })
    setChecked(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, auditors, attendees])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/board-room/attendees', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: meetingId,
          attendees: allMembers.map(m => ({ member_id: m.id, attended: !!checked[m.id] })),
        }),
      })
      const json = await res.json()
      if (json.success) {
        onChanged()
      } else {
        setError(json.error || t('errorGeneric'))
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">{t('attendanceHeading')}</h3>

      {/* Quorum badge */}
      <div
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-4 border ${
          quorum.met
            ? 'bg-green-50 text-green-800 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${quorum.met ? 'bg-green-500' : 'bg-red-400'}`} />
        {t('quorumSummary', {
          total: quorum.total,
          attended: quorum.attended,
          required: quorum.required,
        })}
        &nbsp;—&nbsp;
        {quorum.met ? t('quorumMet') : t('quorumNotMet')}
      </div>

      {isAdmin ? (
        /* Admin: editable checkbox list */
        <div>
          <div className="space-y-2 mb-4">
            {roster.map(member => (
              <label
                key={member.id}
                className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 px-2 py-1.5 rounded-lg transition-colors"
              >
                <input
                  type="checkbox"
                  checked={!!checked[member.id]}
                  onChange={e => setChecked(prev => ({ ...prev, [member.id]: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-900">{member.display_name}</span>
                {member.director_title && (
                  <span className="text-xs text-gray-500">({member.director_title})</span>
                )}
              </label>
            ))}
          </div>
          {auditors.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {t('auditorsHeading')}
              </p>
              <div className="space-y-2">
                {auditors.map(member => (
                  <label
                    key={member.id}
                    className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 px-2 py-1.5 rounded-lg transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={!!checked[member.id]}
                      onChange={e =>
                        setChecked(prev => ({ ...prev, [member.id]: e.target.checked }))
                      }
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-gray-900">{member.display_name}</span>
                    <span className="text-xs text-amber-600">{t('auditorTag')}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      ) : (
        /* Non-admin: read-only view */
        <div className="space-y-1">
          {roster.map(member => {
            const attended = attendees.find(a => a.member_id === member.id)?.attended ?? false
            return (
              <div key={member.id} className="flex items-center gap-2 text-sm py-1">
                <span
                  className={`w-2 h-2 rounded-full ${attended ? 'bg-green-500' : 'bg-gray-300'}`}
                />
                <span className={attended ? 'text-gray-900' : 'text-gray-400'}>
                  {member.display_name}
                </span>
                {member.director_title && (
                  <span className="text-xs text-gray-400">({member.director_title})</span>
                )}
              </div>
            )
          })}
          {auditors.length > 0 && (
            <div className="pt-3 mt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {t('auditorsHeading')}
              </p>
              {auditors.map(member => {
                const attended = attendees.find(a => a.member_id === member.id)?.attended ?? false
                return (
                  <div key={member.id} className="flex items-center gap-2 text-sm py-1">
                    <span
                      className={`w-2 h-2 rounded-full ${attended ? 'bg-green-500' : 'bg-gray-300'}`}
                    />
                    <span className={attended ? 'text-gray-900' : 'text-gray-400'}>
                      {member.display_name}
                    </span>
                    <span className="text-xs text-amber-600">{t('auditorTag')}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
