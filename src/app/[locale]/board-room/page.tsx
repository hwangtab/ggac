'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { resolveBoardMeetingTime } from '@/constants/boardRoom'
import type { BoardMeetingStatus } from '@/constants/boardRoom'
import { fetchSessionProfile, isApprovedActiveAdmin } from '@/utils/sessionProfile'
import StatusBadge from './_components/StatusBadge'

interface Meeting {
  id: string
  title: string
  meeting_date: string | null
  meeting_time: string | null
  location: string | null
  status: BoardMeetingStatus
  vote_deadline: string | null
  created_at: string
}

export default function BoardRoomPage() {
  const dash = useTranslations('boardRoom.dashboard')

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

  // Fetch meetings
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
          setError(json.error || dash('error'))
        }
      } catch {
        if (mounted) setError(dash('error'))
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [dash])

  const pollingMeetings = meetings.filter(m => m.status === 'polling')
  const scheduledMeetings = meetings.filter(m => m.status === 'scheduled')
  const completedMeetings = meetings.filter(m => m.status === 'completed')

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="h-8 w-48 bg-gray-200 rounded mb-8 animate-pulse" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-pulse"
            >
              <div className="h-5 w-24 bg-gray-200 rounded mb-3" />
              <div className="h-6 w-2/3 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{dash('heading')}</h1>
        {isAdmin && (
          <Link
            href="/board-room/meetings/new"
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            + {dash('createMeeting')}
          </Link>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 투표 중 섹션 */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-400 rounded-full inline-block" />
          {dash('polling')}
        </h2>
        {pollingMeetings.length === 0 ? (
          <p className="text-sm text-gray-500 pl-4">{dash('noPolling')}</p>
        ) : (
          <div className="space-y-3">
            {pollingMeetings.map(m => (
              <MeetingCard key={m.id} meeting={m} viewDetailLabel={dash('viewDetail')} />
            ))}
          </div>
        )}
      </section>

      {/* 예정 섹션 */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-400 rounded-full inline-block" />
          {dash('scheduled')}
        </h2>
        {scheduledMeetings.length === 0 ? (
          <p className="text-sm text-gray-500 pl-4">{dash('noScheduled')}</p>
        ) : (
          <div className="space-y-3">
            {scheduledMeetings.map(m => (
              <MeetingCard key={m.id} meeting={m} viewDetailLabel={dash('viewDetail')} />
            ))}
          </div>
        )}
      </section>

      {/* 지난 회의 섹션 */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-gray-400 rounded-full inline-block" />
          {dash('completed')}
        </h2>
        {completedMeetings.length === 0 ? (
          <p className="text-sm text-gray-500 pl-4">{dash('noCompleted')}</p>
        ) : (
          <div className="space-y-3">
            {completedMeetings.map(m => (
              <MeetingCard key={m.id} meeting={m} viewDetailLabel={dash('viewDetail')} />
            ))}
          </div>
        )}
      </section>

      {/* 서류함 바로가기 */}
      <section>
        <Link
          href="/board-room/documents"
          className="block p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-primary-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 group-hover:text-primary-700 transition-colors">
                {dash('documentsTitle')}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{dash('documentsDesc')}</p>
            </div>
            <span className="text-primary-600 text-sm font-medium group-hover:underline">
              {dash('documentsLink')} →
            </span>
          </div>
        </Link>
      </section>
    </div>
  )
}

function MeetingCard({ meeting, viewDetailLabel }: { meeting: Meeting; viewDetailLabel: string }) {
  return (
    <Link
      href={`/board-room/meetings/${meeting.id}`}
      className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-primary-300 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={meeting.status} />
          </div>
          <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
            {meeting.title}
          </h3>
          {meeting.meeting_date && (
            <p className="text-sm text-gray-500 mt-1">
              {meeting.meeting_date} {resolveBoardMeetingTime(meeting.meeting_time)}
              {meeting.location && ` · ${meeting.location}`}
            </p>
          )}
          {!meeting.meeting_date && meeting.vote_deadline && (
            <p className="text-sm text-gray-500 mt-1">
              투표 마감: {new Date(meeting.vote_deadline).toLocaleDateString('ko-KR')}
            </p>
          )}
        </div>
        <span className="text-primary-600 text-sm font-medium shrink-0 group-hover:underline">
          {viewDetailLabel} →
        </span>
      </div>
    </Link>
  )
}
