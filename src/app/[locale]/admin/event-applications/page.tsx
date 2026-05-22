'use client'

import { useState, useEffect, useCallback } from 'react'
import { FiClipboard, FiRefreshCw, FiCheck, FiX, FiClock, FiEdit2, FiTrash2 } from 'react-icons/fi'
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
  privacy_consent: boolean
  privacy_consent_at: string | null
  participation_type: string | null
  photo_url: string | null
  created_at: string
  updated_at: string
}

interface EventInfo {
  slug: string
  title: string
}

interface EditForm {
  applicant_name: string
  contact_email: string
  contact_phone: string
  performance_info: string
  items_to_sell: string
  links: string
  message: string
  participation_type: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: '검토 중', color: 'bg-yellow-100 text-yellow-800' },
  approved: { label: '선정', color: 'bg-green-100 text-green-800' },
  rejected: { label: '미선정', color: 'bg-red-100 text-red-800' },
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'
const textareaClass = `${inputClass} resize-none`

function toEditForm(app: EventApplication): EditForm {
  return {
    applicant_name: app.applicant_name,
    contact_email: app.contact_email,
    contact_phone: app.contact_phone ?? '',
    performance_info: app.performance_info ?? '',
    items_to_sell: app.items_to_sell,
    links: app.links ?? '',
    message: app.message ?? '',
    participation_type: app.participation_type ?? '',
  }
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
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<EventApplication | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)

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

  const deleteApplication = async (id: string, name: string) => {
    if (!confirm(`"${name}" 신청을 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.`)) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/admin/event-applications?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('삭제 실패')
      setApplications(prev => prev.filter(app => app.id !== id))
      setTotalCount(prev => prev - 1)
      if (expanded === id) setExpanded(null)
    } catch {
      alert('삭제에 실패했습니다.')
    } finally {
      setDeleting(null)
    }
  }

  const openEdit = (app: EventApplication) => {
    setEditTarget(app)
    setEditForm(toEditForm(app))
  }

  const closeEdit = () => {
    setEditTarget(null)
    setEditForm(null)
  }

  const saveEdit = async () => {
    if (!editTarget || !editForm) return
    setEditSaving(true)
    try {
      const res = await fetch('/api/admin/event-applications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTarget.id,
          applicant_name: editForm.applicant_name,
          contact_email: editForm.contact_email,
          contact_phone: editForm.contact_phone || null,
          performance_info: editForm.performance_info || null,
          items_to_sell: editForm.items_to_sell,
          links: editForm.links || null,
          message: editForm.message || null,
          participation_type: editForm.participation_type || null,
        }),
      })
      if (!res.ok) throw new Error('수정 실패')
      setApplications(prev =>
        prev.map(app =>
          app.id === editTarget.id
            ? {
                ...app,
                applicant_name: editForm.applicant_name,
                contact_email: editForm.contact_email,
                contact_phone: editForm.contact_phone || null,
                performance_info: editForm.performance_info || null,
                items_to_sell: editForm.items_to_sell,
                links: editForm.links || null,
                message: editForm.message || null,
                participation_type: editForm.participation_type || null,
              }
            : app
        )
      )
      closeEdit()
    } catch {
      alert('수정에 실패했습니다.')
    } finally {
      setEditSaving(false)
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
                        <div>
                          <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            개인정보 동의
                          </dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            {app.privacy_consent_at
                              ? new Date(app.privacy_consent_at).toLocaleString('ko-KR')
                              : app.privacy_consent
                                ? '동의 (시각 미기록)'
                                : '—'}
                          </dd>
                        </div>
                        {app.participation_type && (
                          <div>
                            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              참여 분야
                            </dt>
                            <dd className="mt-1 flex flex-wrap gap-1">
                              {app.participation_type.split(',').map(type => (
                                <span
                                  key={type}
                                  className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700"
                                >
                                  {type === 'booth'
                                    ? '1부 — 도떼기 시장'
                                    : type === 'performance'
                                      ? '2부 — 보따리 옥션'
                                      : type}
                                </span>
                              ))}
                            </dd>
                          </div>
                        )}
                        {app.photo_url && (
                          <div className="md:col-span-2">
                            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                              포트폴리오 사진
                            </dt>
                            <dd className="mt-1">
                              <a href={app.photo_url} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={app.photo_url}
                                  alt="포트폴리오"
                                  className="h-40 w-auto rounded-lg object-cover border border-gray-200 hover:opacity-80 transition-opacity"
                                />
                              </a>
                            </dd>
                          </div>
                        )}
                      </dl>

                      {/* 상태 변경 + 수정/삭제 버튼 */}
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 flex-wrap">
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
                        <span className="flex-1" />
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            openEdit(app)
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                        >
                          <FiEdit2 className="w-3 h-3" />
                          수정
                        </button>
                        <button
                          disabled={deleting === app.id}
                          onClick={e => {
                            e.stopPropagation()
                            deleteApplication(app.id, app.applicant_name)
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <FiTrash2 className="w-3 h-3" />
                          삭제
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

      {/* 수정 모달 */}
      {editTarget && editForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => {
            if (e.target === e.currentTarget) closeEdit()
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">신청 정보 수정</h2>
              <button
                onClick={closeEdit}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">
                    신청자 / 팀명 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.applicant_name}
                    onChange={e => setEditForm(f => f && { ...f, applicant_name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">
                    이메일 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={editForm.contact_email}
                    onChange={e => setEditForm(f => f && { ...f, contact_email: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">연락처</label>
                  <input
                    type="tel"
                    value={editForm.contact_phone}
                    onChange={e => setEditForm(f => f && { ...f, contact_phone: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">링크</label>
                  <input
                    type="text"
                    value={editForm.links}
                    onChange={e => setEditForm(f => f && { ...f, links: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  판매할 물건 <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={editForm.items_to_sell}
                  onChange={e => setEditForm(f => f && { ...f, items_to_sell: e.target.value })}
                  className={textareaClass}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">공연 소개</label>
                <textarea
                  rows={3}
                  value={editForm.performance_info}
                  onChange={e => setEditForm(f => f && { ...f, performance_info: e.target.value })}
                  className={textareaClass}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">기타 요청사항</label>
                <textarea
                  rows={2}
                  value={editForm.message}
                  onChange={e => setEditForm(f => f && { ...f, message: e.target.value })}
                  className={textareaClass}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  참여 분야 (쉼표 구분)
                </label>
                <input
                  type="text"
                  placeholder="예: booth,performance"
                  value={editForm.participation_type}
                  onChange={e =>
                    setEditForm(f => f && { ...f, participation_type: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
              <button
                onClick={closeEdit}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                disabled={
                  editSaving ||
                  !editForm.applicant_name ||
                  !editForm.contact_email ||
                  !editForm.items_to_sell
                }
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {editSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
