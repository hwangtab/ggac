'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import CandidateDatePicker from '../../_components/CandidateDatePicker'

export default function NewMeetingPage() {
  const t = useTranslations('boardRoom.newMeeting')
  const router = useRouter()

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [voteDeadline, setVoteDeadline] = useState('')
  const [candidateDates, setCandidateDates] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { supabase } = await import('@/lib/supabase/client')
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!mounted) return
        if (session?.user) {
          const { data } = await supabase
            .from('member_profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .single()
          if (mounted) setIsAdmin(!!data?.is_admin)
        } else {
          if (mounted) setIsAdmin(false)
        }
      } catch {
        if (mounted) setIsAdmin(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    setApiError(null)

    if (!title.trim()) {
      setValidationError(t('validationTitle'))
      return
    }
    if (!voteDeadline) {
      setValidationError(t('validationDeadline'))
      return
    }
    if (candidateDates.length === 0) {
      setValidationError(t('validationDates'))
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/board-room/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          location: location.trim() || undefined,
          vote_deadline: new Date(voteDeadline).toISOString(),
          candidate_dates: candidateDates,
        }),
      })
      const json = await res.json()
      if (json.success) {
        router.push(`/board-room/meetings/${json.data.id}`)
      } else {
        setApiError(json.error || '오류가 발생했습니다.')
      }
    } catch {
      setApiError('오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  // Still loading admin status
  if (isAdmin === null) {
    return (
      <div className="pt-24 md:pt-28 container mx-auto px-4 max-w-2xl">
        <div className="h-8 w-40 bg-gray-200 rounded mb-8 animate-pulse" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // Not admin — show forbidden message
  if (!isAdmin) {
    return (
      <div className="pt-24 md:pt-28 container mx-auto px-4 max-w-2xl pb-16">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
          <p className="text-red-700 font-medium mb-4">{t('forbidden')}</p>
          <Link
            href="/board-room"
            className="inline-flex items-center text-sm text-primary-600 hover:underline"
          >
            ← 이사회로 돌아가기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-24 md:pt-28 container mx-auto px-4 max-w-2xl pb-16">
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/board-room/meetings"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← 회의 목록
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('heading')}</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 md:p-8 space-y-6"
      >
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

        {/* 투표 마감일 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="voteDeadline">
            {t('voteDeadlineLabel')} <span className="text-red-500">*</span>
          </label>
          <input
            id="voteDeadline"
            type="datetime-local"
            value={voteDeadline}
            onChange={e => setVoteDeadline(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            required
          />
        </div>

        {/* 후보 날짜 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('candidateDatesLabel')} <span className="text-red-500">*</span>
          </label>
          <CandidateDatePicker dates={candidateDates} onChange={setCandidateDates} />
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

        {/* 버튼 */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 px-6 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
          <Link
            href="/board-room/meetings"
            className="flex-1 text-center px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t('cancel')}
          </Link>
        </div>
      </form>
    </div>
  )
}
