'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { resolveBoardMeetingTime } from '@/constants/boardRoom'
import type { BoardMeetingStatus, BoardAgendaStatus } from '@/constants/boardRoom'
import { fetchSessionProfile, isApprovedActiveAdmin } from '@/utils/sessionProfile'
import StatusBadge from '../../_components/StatusBadge'
import MeetingCalendar from '../../_components/MeetingCalendar'
import AgendaList from '../../_components/AgendaList'
import MinutesEditor from '../../_components/MinutesEditor'
import AttendancePanel from '../../_components/AttendancePanel'

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface DateOption {
  id: string
  candidate_date: string
}

interface Vote {
  option_id: string
  voter_id: string
  is_available: boolean
}

interface Agenda {
  id: string
  title: string
  content: string | null
  sort_order: number
  status: BoardAgendaStatus
  proposed_by: string
  created_at: string
  comment_count: number
}

interface Minutes {
  id: string
  content: string
  content_format: string
  author_id: string
  updated_at: string
}

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

interface DetailData {
  meeting: Meeting
  meeting_time: string
  options: DateOption[]
  votes: Vote[]
  agendas: Agenda[]
  minutes: Minutes | null
  roster: RosterMember[]
  auditors: RosterMember[]
  attendees: Attendee[]
  quorum: Quorum | null
  /** 이사·감사·관리자면 true. 조합원 열람이면 false — 일정 투표·출석은 응답에 없다. */
  is_board_member?: boolean
  current_user_id: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>()
  const meetingId = params.id
  const t = useTranslations('boardRoom.detail')

  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
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

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        setError(null)
      } else {
        setError(json.error || t('error'))
      }
    } catch {
      setError(t('error'))
    } finally {
      setLoading(false)
    }
  }, [meetingId, t])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  // ── Vote handler ──────────────────────────────────────────────────────────
  const handleVote = async (optionId: string, isAvailable: boolean) => {
    try {
      await fetch('/api/board-room/date-votes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: optionId, is_available: isAvailable }),
      })
      await fetchDetail()
    } catch {
      // silently fail — state will be consistent on next fetch
    }
  }

  // ── Confirm date (admin) ──────────────────────────────────────────────────
  const handleConfirmDate = async (candidateDate: string) => {
    if (!confirm(t('confirmDatePrompt', { date: candidateDate }))) return
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_date: candidateDate }),
      })
      const json = await res.json()
      if (json.success) {
        await fetchDetail()
      }
    } catch {
      // silently fail
    }
  }

  // ── Mark completed (admin) ────────────────────────────────────────────────
  const handleMarkCompleted = async () => {
    if (!confirm(t('markCompletedConfirm'))) return
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      const json = await res.json()
      if (json.success) {
        await fetchDetail()
      }
    } catch {
      // silently fail
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl pb-16">
        <div className="h-5 w-32 bg-gray-200 rounded mb-6 animate-pulse" />
        <div className="h-8 w-2/3 bg-gray-200 rounded mb-4 animate-pulse" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="mx-auto max-w-4xl pb-16">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-gray-600 font-medium mb-4">{t('notFound')}</p>
          <Link href="/board-room/meetings" className="text-sm text-primary-600 hover:underline">
            ← {t('back')}
          </Link>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl pb-16">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
          {error || t('error')}
        </div>
        <Link href="/board-room/meetings" className="text-sm text-primary-600 hover:underline">
          ← {t('back')}
        </Link>
      </div>
    )
  }

  const {
    meeting,
    options,
    votes,
    agendas,
    minutes,
    roster,
    auditors,
    attendees,
    quorum,
    current_user_id,
  } = data

  // 서버가 조합원 응답에서 일정 투표·출석·정족수를 빼고 내려준다. 화면도 같은
  // 기준으로 이사회 전용 영역을 감춘다.
  const isBoardMember = data.is_board_member !== false

  const votingClosed = meeting.vote_deadline ? new Date(meeting.vote_deadline) < new Date() : false

  const isPolling = meeting.status === 'polling'
  const isScheduledOrCompleted = meeting.status === 'scheduled' || meeting.status === 'completed'

  return (
    <div className="mx-auto max-w-4xl pb-16">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/board-room/meetings"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← {t('back')}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <StatusBadge status={meeting.status} />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{meeting.title}</h1>

        {isScheduledOrCompleted && meeting.meeting_date && (
          <p className="text-gray-600 text-sm">
            {meeting.meeting_date} {resolveBoardMeetingTime(meeting.meeting_time)}
            {meeting.location && ` · ${meeting.location}`}
          </p>
        )}

        {isPolling && meeting.vote_deadline && (
          <p className="text-sm text-gray-500">
            {t('voteDeadline')}: {new Date(meeting.vote_deadline).toLocaleString('ko-KR')}
            {votingClosed && (
              <span className="ml-2 text-amber-600 font-medium">({t('votingClosedShort')})</span>
            )}
          </p>
        )}
      </div>

      {/* ── POLLING VIEW ─────────────────────────────────────────────── */}
      {isPolling && !isBoardMember && (
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 mb-6">
          <p className="text-sm text-gray-500">{t('pollingMemberNote')}</p>
        </section>
      )}

      {isPolling && isBoardMember && (
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">{t('dateVoteHeading')}</h2>
          {options.length === 0 ? (
            <p className="text-sm text-gray-500 italic">{t('noOptions')}</p>
          ) : (
            <MeetingCalendar
              mode="vote"
              meetingTime={meeting.meeting_time}
              options={options}
              votes={votes}
              roster={roster}
              currentUserId={current_user_id}
              votingClosed={votingClosed}
              onVote={handleVote}
              onConfirm={isAdmin ? handleConfirmDate : undefined}
            />
          )}
        </section>
      )}

      {/* ── SCHEDULED / COMPLETED VIEW ───────────────────────────────── */}
      {isScheduledOrCompleted && (
        <div className="space-y-6">
          {/* Admin: mark completed button */}
          {isAdmin && meeting.status === 'scheduled' && (
            <div className="flex justify-end">
              <button
                onClick={handleMarkCompleted}
                className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors"
              >
                {t('markCompleted')}
              </button>
            </div>
          )}

          {/* Agenda */}
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <AgendaList
              agendas={agendas}
              currentUserId={current_user_id}
              isAdmin={isAdmin}
              readOnly={!isBoardMember}
              meetingId={meeting.id}
              onChanged={fetchDetail}
            />
          </section>

          {/* Minutes */}
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <MinutesEditor
              minutes={minutes}
              meetingId={meeting.id}
              currentUserId={current_user_id}
              isAdmin={isAdmin}
              readOnly={!isBoardMember}
              onChanged={fetchDetail}
            />
          </section>

          {/* Attendance — 이사회 전용. 조합원 응답에는 명단·출석·정족수가 없다. */}
          {isBoardMember && quorum && (
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <AttendancePanel
                roster={roster}
                auditors={auditors}
                attendees={attendees}
                quorum={quorum}
                meetingId={meeting.id}
                isAdmin={isAdmin}
                onChanged={fetchDetail}
              />
            </section>
          )}
        </div>
      )}
    </div>
  )
}
