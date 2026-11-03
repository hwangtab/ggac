'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'

/**
 * 조합 업무 "참여할게요"(스펙 §6 2항). 지명·배정은 없고, 누른 사람의 기록만
 * 남는다. 손들기는 `POST …/volunteer`(켜짐 + 참여 자격 + 조합 업무 스위치 + 열린
 * 글), 철회는 `DELETE …/volunteer`(언제든 된다).
 */
export default function VolunteerButton({
  listingId,
  initialVolunteered,
  initialCount,
  canVolunteer,
  unavailableReason = null,
}: {
  listingId: string
  initialVolunteered: boolean
  initialCount: number
  /** 지금 새로 손들 수 있다(쓰기 판정 ok + `coop_tasks_enabled` + 열린 글). */
  canVolunteer: boolean
  /** 손들 수 없는 이유. 참여 자격 문제는 위의 게이트가 말하므로 null로 둔다. */
  unavailableReason?: 'closed' | 'off' | null
}) {
  const t = useTranslations('timebank.volunteer')
  const router = useRouter()
  const [volunteered, setVolunteered] = useState(initialVolunteered)
  const [count, setCount] = useState(initialCount)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (method: 'POST' | 'DELETE') => {
    if (method === 'DELETE' && !window.confirm(t('withdrawConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/timebank/listings/${listingId}/volunteer`, { method })
      if (!response.ok) {
        const json = await response.json().catch(() => null)
        setError(json?.error || t('error'))
        return
      }
      const next = method === 'POST'
      if (next !== volunteered) setCount(prev => Math.max(0, prev + (next ? 1 : -1)))
      setVolunteered(next)
      router.refresh()
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">{t('count', { count })}</p>
      <div className="flex flex-wrap items-center gap-3">
        {volunteered ? (
          <>
            <span className="text-sm font-medium text-primary-700">{t('joined')}</span>
            <button
              type="button"
              onClick={() => void send('DELETE')}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('withdraw')}
            </button>
          </>
        ) : canVolunteer ? (
          <button
            type="button"
            onClick={() => void send('POST')}
            disabled={busy}
            className="rounded-lg bg-primary-600 px-5 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {t('join')}
          </button>
        ) : unavailableReason ? (
          <span className="text-sm text-gray-500">{t(unavailableReason)}</span>
        ) : null}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
