'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import {
  DEFAULT_BOARD_MEETING_TIME,
  resolveBoardMeetingTime,
  type BoardMeetingStatus,
} from '@/constants/boardRoom'
import { fetchSessionProfile, isApprovedActiveAdmin } from '@/utils/sessionProfile'

interface Meeting {
  id: string
  title: string
  meeting_date: string | null
  meeting_time: string | null
  location: string | null
  status: BoardMeetingStatus
  vote_deadline: string | null
}

/** Convert a stored ISO timestamp to a value for <input type="datetime-local"> (local time, no tz). */
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EditMeetingPage() {
  const params = useParams<{ id: string }>()
  const meetingId = params.id
  const t = useTranslations('boardRoom.editMeeting')
  const router = useRouter()

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form fields
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [voteDeadline, setVoteDeadline] = useState('')
  const [meetingTime, setMeetingTime] = useState<string>(DEFAULT_BOARD_MEETING_TIME)

  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false) // complete/delete in-flight
  const [validationError, setValidationError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

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

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      const json = await res.json()
      if (json.success) {
        const m: Meeting = json.data.meeting
        setMeeting(m)
        setTitle(m.title || '')
        setLocation(m.location || '')
        setVoteDeadline(isoToDatetimeLocal(m.vote_deadline))
        setMeetingTime(resolveBoardMeetingTime(m.meeting_time))
        setLoadError(null)
      } else {
        setLoadError(json.error || t('error'))
      }
    } catch {
      setLoadError(t('error'))
    } finally {
      setLoading(false)
    }
  }, [meetingId, t])

  useEffect(() => {
    fetchMeeting()
  }, [fetchMeeting])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    setApiError(null)
    if (!meeting) return

    if (!title.trim()) {
      setValidationError(t('validationTitle'))
      return
    }

    // Build only changed fields
    const body: Record<string, unknown> = {}
    if (title.trim() !== (meeting.title || '')) body.title = title.trim()
    if (location.trim() !== (meeting.location || '')) body.location = location.trim()
    const newDeadlineIso = voteDeadline ? new Date(voteDeadline).toISOString() : null
    const oldDeadlineIso = meeting.vote_deadline
      ? new Date(meeting.vote_deadline).toISOString()
      : null
    if (newDeadlineIso !== oldDeadlineIso && newDeadlineIso) body.vote_deadline = newDeadlineIso
    if (meetingTime !== resolveBoardMeetingTime(meeting.meeting_time)) {
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(meetingTime)) {
        setValidationError(t('validationTime'))
        return
      }
      body.meeting_time = meetingTime
    }

    if (Object.keys(body).length === 0) {
      setValidationError(t('noChanges'))
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.success) {
        router.push(`/board-room/meetings/${meetingId}`)
      } else {
        setApiError(json.error || t('errorGeneric'))
      }
    } catch {
      setApiError(t('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  const handleComplete = async () => {
    if (!confirm(t('confirmComplete'))) return
    setApiError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      const json = await res.json()
      if (json.success) {
        router.push(`/board-room/meetings/${meetingId}`)
      } else {
        setApiError(json.error || t('errorGeneric'))
      }
    } catch {
      setApiError(t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(t('confirmDelete'))) return
    setApiError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/board-room/meetings/${meetingId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (json.success) {
        router.push('/board-room/meetings')
      } else {
        setApiError(json.error || t('errorGeneric'))
        setBusy(false)
      }
    } catch {
      setApiError(t('errorGeneric'))
      setBusy(false)
    }
  }

  // ── Loading (admin status or meeting still loading) ───────────────────────
  if (isAdmin === null || loading) {
    return (
      <div className="mx-auto max-w-2xl pb-16">
        <div className="h-8 w-40 bg-gray-200 rounded mb-8 animate-pulse" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // ── Not admin ─────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl pb-16">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
          <p className="text-red-700 font-medium mb-4">{t('forbidden')}</p>
          <Link
            href={`/board-room/meetings/${meetingId}`}
            className="inline-flex items-center text-sm text-primary-600 hover:underline"
          >
            ← {t('back')}
          </Link>
        </div>
      </div>
    )
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl pb-16">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-gray-600 font-medium mb-4">{t('notFound')}</p>
          <Link href="/board-room/meetings" className="text-sm text-primary-600 hover:underline">
            ←
          </Link>
        </div>
      </div>
    )
  }

  // ── Load error ────────────────────────────────────────────────────────────
  if (loadError || !meeting) {
    return (
      <div className="mx-auto max-w-2xl pb-16">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
          {loadError || t('error')}
        </div>
        <Link
          href={`/board-room/meetings/${meetingId}`}
          className="text-sm text-primary-600 hover:underline"
        >
          ← {t('back')}
        </Link>
      </div>
    )
  }

  const isScheduled = meeting.status === 'scheduled'

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <div className="flex items-center gap-3 mb-8">
        <Link
          href={`/board-room/meetings/${meetingId}`}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← {t('back')}
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('heading')}</h1>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 md:p-8 space-y-6"
      >
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          {t('dateNotice')}
        </p>

        {/* 제목 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="title">
            {t('titleLabel')} <span className="text-red-500">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            required
          />
        </div>

        {/* 장소 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="location">
            {t('locationLabel')}
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder={t('locationPlaceholder')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        {/* 회의 시각 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="meetingTime">
            {t('meetingTimeLabel')}
          </label>
          <input
            id="meetingTime"
            type="time"
            value={meetingTime}
            onChange={e => setMeetingTime(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">{t('meetingTimeHint')}</p>
        </div>

        {/* 투표 마감일 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="voteDeadline">
            {t('voteDeadlineLabel')}
          </label>
          <input
            id="voteDeadline"
            type="datetime-local"
            value={voteDeadline}
            onChange={e => setVoteDeadline(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">{t('voteDeadlineHint')}</p>
        </div>

        {/* 유효성 오류 */}
        {validationError && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
            {validationError}
          </div>
        )}

        {/* API 오류 */}
        {apiError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {apiError}
          </div>
        )}

        {/* 저장 / 취소 */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || busy}
            className="flex-1 px-6 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t('saving') : t('save')}
          </button>
          <Link
            href={`/board-room/meetings/${meetingId}`}
            className="flex-1 text-center px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t('cancel')}
          </Link>
        </div>
      </form>

      {/* 위험 작업: 회의 종료 / 삭제 */}
      <div className="mt-8 border-t border-gray-200 pt-6 flex flex-col sm:flex-row gap-3">
        {isScheduled && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={busy || saving}
            className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {t('completeMeeting')}
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy || saving}
          className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {t('deleteMeeting')}
        </button>
      </div>
    </div>
  )
}
