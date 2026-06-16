'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { differenceInCalendarDays } from 'date-fns'
import { Link } from '@/i18n/navigation'
import type { BoardMeetingStatus } from '@/constants/boardRoom'
import { fetchSessionProfile, isApprovedActiveAdmin } from '@/utils/sessionProfile'
import StatusBadge from '../_components/StatusBadge'

interface Meeting {
  id: string
  title: string
  meeting_date: string | null
  location: string | null
  status: BoardMeetingStatus
  vote_deadline: string | null
  created_at: string
}

export default function SchedulePollPage() {
  const t = useTranslations('boardRoom.schedule')

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await fetchSessionProfile()
        if (mounted) setIsAdmin(isApprovedActiveAdmin(session.profile))
      } catch {
        if (mounted) setIsAdmin(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/board-room/meetings')
        const json = await res.json()
        if (!mounted) return
        if (json.success) {
          setMeetings(json.data.meetings || [])
        } else {
          setError(json.error || t('error'))
        }
      } catch {
        if (mounted) setError(t('error'))
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [t])

  // Only meetings currently in the polling stage.
  const pollingMeetings = meetings.filter(m => m.status === 'polling')

  const deadlineLabel = (m: Meeting): string => {
    if (!m.vote_deadline) return ''
    const deadline = new Date(m.vote_deadline)
    const days = differenceInCalendarDays(deadline, new Date())
    const dateStr = deadline.toLocaleDateString('ko-KR')
    if (days < 0) return t('deadlinePassed', { date: dateStr })
    if (days === 0) return t('deadlineToday', { date: dateStr })
    return t('deadlineRemaining', { date: dateStr, days })
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl pb-16">
        <div className="h-8 w-40 bg-gray-200 rounded mb-8 animate-pulse" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 animate-pulse"
            >
              <div className="h-5 w-24 bg-gray-200 rounded mb-2" />
              <div className="h-6 w-2/3 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Link
            href="/board-room"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← {t('back')}
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('heading')}</h1>
        </div>
        {isAdmin && (
          <Link
            href="/board-room/meetings/new"
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            + {t('createMeeting')}
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-8">{t('description')}</p>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {pollingMeetings.length === 0 && !error ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-gray-500">{t('empty')}</p>
          {isAdmin && (
            <Link
              href="/board-room/meetings/new"
              className="inline-flex items-center mt-4 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              + {t('createMeeting')}
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {pollingMeetings.map(m => (
            <Link
              key={m.id}
              href={`/board-room/meetings/${m.id}`}
              className="flex items-center justify-between gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-primary-300 hover:shadow-md transition-all group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={m.status} />
                </div>
                <p className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
                  {m.title}
                </p>
                {m.vote_deadline && (
                  <p className="text-sm text-gray-500 mt-0.5">{deadlineLabel(m)}</p>
                )}
              </div>
              <span className="text-gray-400 group-hover:text-primary-600 transition-colors shrink-0">
                →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
