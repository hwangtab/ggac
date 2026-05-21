'use client'

import { useState, useEffect, useCallback } from 'react'
import { FiClipboard, FiRefreshCw, FiCheck, FiX, FiClock } from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'

interface EventApplication {
  id: string
  event_slug: string
  applicant_name: string
  contact_email: string
  contact_phone: string | null
  performance_info: string | null
  items_to_sell: string
  links: string | null
  message: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  updated_at: string
}

interface EventInfo {
  slug: string
  title: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: '검토 중', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '선정', color: 'bg-green-100 text-green-800' },
  rejected: { label: '미선정', color: 'bg-red-100 text-red-800' },
}

export default function EventApplicationsPage() {
  const [applications, setApplications] = useState<EventApplication[]>([])
  const [events, setEvents] = useState<EventInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eventSlug, setEventSlug] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [totalCount, setTotalCount] = useState(0)
  const [updating, setUpdating] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchApplications = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (eventSlug) params.set('event_slug', eventSlug)
      if (filter !== 'all') params.set('status', filter)

      const res = await fetch(`/api/admin/event-applications?${params}`)
      if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.')
      const json = await res.json()
      setApplications(json.data?.applications ?? [])
      setTotalCount(json.data?.pagination?.totalCount ?? 0)
      if (json.data?.events?.length) {
        setEvents(json.data.events)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [eventSlug, filter])

  useEffect(() => {
    fetchApplications()
  }, [fetchApplications])

  const updateStatus = async (id: string, status: 'pending' | 'approved' | 'rejected') => {
    setUpdating(id)
    try {
      const res = await fetch('/api/admin/event-applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error('업데이트 실패')
      setApplications(prev => prev.map(app => (app.id === id ? { ...app, status } : app)))
    } catch {
      alert('상태 업데이트에 실패했습니다.')
    } finally {
      setUpdating(null)
    }
  }

  const eventMap = Object.fromEntries(events.map(e => [e.slug, e.title]))

  const selectedEventTitle = eventSlug ? (eventMap[eventSlug] ?? eventSlug) : '전체 행사'

  const filterButtons: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `전체 (${totalCount})` },
    { key: 'pending', label: '검토 중' },
    { key: 'approved', label: '선정' },
    { key: 'rejected', label: '미선정' },
  ]

  return (
    <AdminLayout title="행사 신청 내역" description="공연·판매 신청 조회 및 선정 관리">
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
              <FiClipboard className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">공연·판매 신청 내역</h1>
              <p className="text-sm text-gray-500">{selectedEventTitle}</p>
            </div>
          </div>
          <button
            onClick={fetchApplications}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        {/* 행사 드롭다운 */}
        <div className="flex items-center gap-3">
          <label
            htmlFor="event-select"
            className="text-sm font-medium text-gray-700 whitespace-nowrap"
          >
            행사
          </label>
          <select
            id="event-select"
            value={eventSlug}
            onChange={e => {
              setEventSlug(e.target.value)
              setExpanded(null)
            }}
            className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">전체 행사</option>
            {events.map(e => (
              <option key={e.slug} value={e.slug}>
                {e.title}
              </option>
            ))}
          </select>
        </div>

        {/* 상태 필터 */}
        <div className="flex gap-2 flex-wrap">
          {filterButtons.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                filter === key
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 오류 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* 목록 */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : applications.length === 0 ? (
          <div className="py-16 text-center text-gray-500">신청 내역이 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {applications.map(app => {
              const isExpanded = expanded === app.id
              const statusInfo = STATUS_LABELS[app.status]
              const eventTitle = eventMap[app.event_slug] ?? app.event_slug
              return (
                <div
                  key={app.id}
                  className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
                >
                  {/* 요약 행 */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : app.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 truncate">
                          {app.applicant_name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                        {!eventSlug && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 truncate max-w-[200px]">
                            {eventTitle}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5 truncate">
                        {app.contact_email}
                        {app.contact_phone && ` · ${app.contact_phone}`}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>

                  {/* 상세 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 p-4 space-y-4">
                      <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            판매할 물건
                          </dt>
                          <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                            {app.items_to_sell}
                          </dd>
                        </div>
                        {app.performance_info && (
                          <div>
                            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              공연 소개
                            </dt>
                            <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                              {app.performance_info}
                            </dd>
                          </div>
                        )}
                        {app.links && (
                          <div>
                            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              링크
                            </dt>
                            <dd className="mt-1 text-sm text-primary-600 break-all">{app.links}</dd>
                          </div>
                        )}
                        {app.message && (
                          <div className="md:col-span-2">
                            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              기타 요청사항
                            </dt>
                            <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                              {app.message}
                            </dd>
                          </div>
                        )}
                      </dl>

                      {/* 상태 변경 버튼 */}
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                        <span className="text-sm text-gray-500 mr-1">상태 변경:</span>
                        <button
                          disabled={updating === app.id || app.status === 'approved'}
                          onClick={() => updateStatus(app.id, 'approved')}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <FiCheck className="w-3 h-3" />
                          선정
                        </button>
                        <button
                          disabled={updating === app.id || app.status === 'pending'}
                          onClick={() => updateStatus(app.id, 'pending')}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <FiClock className="w-3 h-3" />
                          검토 중
                        </button>
                        <button
                          disabled={updating === app.id || app.status === 'rejected'}
                          onClick={() => updateStatus(app.id, 'rejected')}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <FiX className="w-3 h-3" />
                          미선정
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
