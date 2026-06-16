'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BOARD_MEETING_TIME } from '@/constants/boardRoom'
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

const UNKNOWN_YEAR = 'unknown'

function getMeetingYearKey(createdAt: string): string {
  const year = new Date(createdAt).getFullYear()
  return Number.isInteger(year) ? String(year) : UNKNOWN_YEAR
}

export default function MeetingListPage() {
  const t = useTranslations('boardRoom.meetingList')

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

  // Group meetings by year (newest first)
  const groupedByYear = meetings.reduce<Record<string, Meeting[]>>((acc, m) => {
    const year = getMeetingYearKey(m.created_at)
    if (!acc[year]) acc[year] = []
    acc[year].push(m)
    return acc
  }, {})
  const sortedYears = Object.keys(groupedByYear).sort((a, b) => {
    if (a === UNKNOWN_YEAR) return 1
    if (b === UNKNOWN_YEAR) return -1
    return b.localeCompare(a)
  })

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="h-8 w-40 bg-gray-200 rounded mb-8 animate-pulse" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
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
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/board-room"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← 이사회
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

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {meetings.length === 0 && !error ? (
        <p className="text-gray-500 text-center py-16">{t('noMeetings')}</p>
      ) : (
        <div className="space-y-10">
          {sortedYears.map(year => (
            <div key={year}>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                {year === UNKNOWN_YEAR ? '날짜 미상' : year}
              </h2>
              <div className="space-y-3">
                {groupedByYear[year].map(m => (
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
                      {m.meeting_date ? (
                        <p className="text-sm text-gray-500 mt-0.5">
                          {m.meeting_date} {BOARD_MEETING_TIME}
                          {m.location && ` · ${m.location}`}
                        </p>
                      ) : m.vote_deadline ? (
                        <p className="text-sm text-gray-500 mt-0.5">
                          투표 마감: {new Date(m.vote_deadline).toLocaleDateString('ko-KR')}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-gray-400 group-hover:text-primary-600 transition-colors shrink-0">
                      →
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
