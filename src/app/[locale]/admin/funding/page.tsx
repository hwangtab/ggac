'use client'

import { useCallback, useEffect, useState } from 'react'
import { FiDollarSign, FiExternalLink, FiRefreshCw } from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import {
  nextStatus,
  PUBLIC_CAMPAIGN_STATUSES,
  type CampaignStatus,
} from '@/lib/funding/transitions'

// 서버 규칙(`@/lib/funding/campaignInput`의 isValidSlug)과 동일하게 유지한다.
// db 스키마를 끌어오는 서버 모듈을 클라이언트 번들에 넣지 않으려 정규식만 복제한다.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function isValidSlugInput(value: string): boolean {
  return value.length >= 3 && value.length <= 60 && SLUG_RE.test(value)
}

interface Campaign {
  id: string
  slug: string
  owner_user_id: string | null
  title: string
  summary: string
  category: string
  goal_amount: number
  status: CampaignStatus
  review_note: string | null
  submitted_at: string | null
  approved_at: string | null
  closed_at: string | null
  settled_at: string | null
  created_at: string
  updated_at: string
  progress: { raised_amount: number; backer_count: number }
}

type FilterKey = 'submitted' | 'all' | 'draft' | 'active' | 'closed' | 'settled'

const FILTER_BUTTONS: { key: FilterKey; label: string }[] = [
  { key: 'submitted', label: '심사 대기' },
  { key: 'draft', label: '작성 중' },
  { key: 'active', label: '진행 중' },
  { key: 'closed', label: '종료' },
  { key: 'settled', label: '정산 완료' },
  { key: 'all', label: '전체' },
]

const STATUS_LABELS: Record<CampaignStatus, { label: string; color: string }> = {
  draft: { label: '작성 중', color: 'bg-gray-100 text-gray-700' },
  submitted: { label: '심사 대기', color: 'bg-yellow-100 text-yellow-800' },
  active: { label: '진행 중', color: 'bg-green-100 text-green-800' },
  closed: { label: '종료', color: 'bg-blue-100 text-blue-800' },
  settled: { label: '정산 완료', color: 'bg-purple-100 text-purple-800' },
}

function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminFundingPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filter, setFilter] = useState<FilterKey>('submitted')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [slugDrafts, setSlugDrafts] = useState<Record<string, string>>({})
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      const res = await fetch(`/api/admin/funding/campaigns?${params}`)
      const json = await res.json()
      if (res.ok === false) throw new Error(json?.error?.message ?? '목록을 불러오지 못했습니다.')
      const list: Campaign[] = json.data.campaigns
      setCampaigns(list)
      // 승인 입력값 초기화: 이미 정식 주소(비-draft-)를 갖고 있으면 미리 채운다.
      setSlugDrafts(prev => {
        const next = { ...prev }
        for (const c of list) {
          if (next[c.id] === undefined) {
            next[c.id] =
              c.slug && !c.slug.startsWith('draft-') && isValidSlugInput(c.slug) ? c.slug : ''
          }
        }
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  async function transition(
    campaign: Campaign,
    action: 'approve' | 'reject' | 'close' | 'settle',
    body: Record<string, unknown> = {}
  ) {
    setBusyId(campaign.id)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/admin/funding/campaigns/${campaign.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const json = await res.json()
      if (res.status === 409) {
        setError(
          '상태가 이미 바뀌었습니다. 다른 관리자가 먼저 처리했습니다. 목록을 새로고침합니다.'
        )
        await load()
        return
      }
      if (res.status === 503) {
        setError(
          `${json?.error?.message ?? '펀딩을 준비 중입니다.'} 시스템 설정 > 기능 설정에서 펀딩 기능을 켜야 심사를 처리할 수 있습니다.`
        )
        return
      }
      if (res.ok === false) throw new Error(json?.error?.message ?? '처리하지 못했습니다.')

      const labels: Record<typeof action, string> = {
        approve: '승인',
        reject: '반려',
        close: '마감',
        settle: '정산 완료 처리',
      }
      setSuccess(`"${campaign.title}"을(를) ${labels[action]}했습니다.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  function handleApprove(campaign: Campaign) {
    const slug = (slugDrafts[campaign.id] ?? '').trim()
    if (!isValidSlugInput(slug)) {
      setError('주소(slug)는 영문 소문자·숫자·하이픈 3~60자입니다.')
      return
    }
    const ok = window.confirm(
      `"${campaign.title}"을(를) 승인해 /funding/${slug} 주소로 공개합니다.\n조합원이 후원을 시작할 수 있게 됩니다. 계속할까요?`
    )
    if (!ok) return
    void transition(campaign, 'approve', { slug })
  }

  function handleReject(campaign: Campaign) {
    const reviewNote = (rejectNotes[campaign.id] ?? '').trim()
    if (!reviewNote) {
      setError('반려 사유를 적어 주세요.')
      return
    }
    const ok = window.confirm(
      `"${campaign.title}"을(를) 반려해 개설자에게 돌려보냅니다.\n개설자가 이 사유를 보게 됩니다. 계속할까요?`
    )
    if (!ok) return
    void transition(campaign, 'reject', { reviewNote })
  }

  function handleClose(campaign: Campaign) {
    const ok = window.confirm(
      `"${campaign.title}"을(를) 마감합니다.\n이후 새 후원을 받을 수 없습니다. 계속할까요?`
    )
    if (!ok) return
    void transition(campaign, 'close')
  }

  function handleSettle(campaign: Campaign) {
    const ok = window.confirm(
      `"${campaign.title}"의 정산을 완료 처리합니다.\n이 동작은 되돌릴 수 없습니다. 계속할까요?`
    )
    if (!ok) return
    void transition(campaign, 'settle')
  }

  const isPublic = (c: Campaign) =>
    (PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(c.status)

  return (
    <AdminLayout
      title="펀딩 심사"
      description="제출된 캠페인을 검토하고 승인·반려·마감·정산을 처리합니다."
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
              <FiDollarSign className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">캠페인 심사</h2>
              <p className="text-sm text-gray-500">
                제출된 캠페인을 승인하면 주소가 확정되고 공개됩니다.
              </p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {FILTER_BUTTONS.map(({ key, label }) => (
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

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-16 text-center text-gray-500">해당하는 캠페인이 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => {
              const busy = busyId === c.id
              const canApprove = nextStatus(c.status, 'approve') !== null
              const canReject = nextStatus(c.status, 'reject') !== null
              const canClose = nextStatus(c.status, 'close') !== null
              const canSettle = nextStatus(c.status, 'settle') !== null
              const statusInfo = STATUS_LABELS[c.status]
              const slugValue = slugDrafts[c.id] ?? ''
              const slugValid = isValidSlugInput(slugValue)

              return (
                <div
                  key={c.id}
                  className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">{c.title}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          {c.category}
                        </span>
                        {isPublic(c) && (
                          <a
                            href={`/funding/${c.slug}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                          >
                            <FiExternalLink className="w-3 h-3" />
                            공개 페이지
                          </a>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 max-w-2xl">{c.summary}</p>
                      <div className="mt-1 text-xs text-gray-500">
                        개설자 ID: <span className="font-mono">{c.owner_user_id ?? '—'}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        생성 {formatDate(c.created_at)}
                        {c.submitted_at && ` · 제출 ${formatDate(c.submitted_at)}`}
                        {' · 목표 '}
                        {won(c.goal_amount)}
                        {isPublic(c) && (
                          <>
                            {' · 모금 '}
                            {won(c.progress.raised_amount)}
                            {` · 후원자 ${c.progress.backer_count.toLocaleString('ko-KR')}명`}
                          </>
                        )}
                      </div>
                      {c.review_note && c.status === 'draft' && (
                        <p className="mt-1 text-xs text-amber-700">반려 사유: {c.review_note}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-gray-100">
                    {canApprove && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600">
                          공개 주소(slug) — /funding/
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={slugValue}
                            disabled={busy}
                            onChange={e =>
                              setSlugDrafts(prev => ({ ...prev, [c.id]: e.target.value.trim() }))
                            }
                            placeholder="예: our-first-album"
                            className="w-56 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                          <button
                            type="button"
                            disabled={busy || !slugValid}
                            onClick={() => handleApprove(c)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            승인
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">
                          {slugValue
                            ? slugValid
                              ? `공개 주소: /funding/${slugValue}`
                              : '영문 소문자·숫자·하이픈 3~60자로 입력해 주세요.'
                            : '개설자가 정하지 않았습니다. 관리자가 직접 정합니다.'}
                        </p>
                      </div>
                    )}

                    {canReject && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600">
                          반려 사유 — 개설자가 이 내용을 봅니다
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={rejectNotes[c.id] ?? ''}
                            disabled={busy}
                            onChange={e =>
                              setRejectNotes(prev => ({ ...prev, [c.id]: e.target.value }))
                            }
                            placeholder="예: 리워드 설명을 더 구체적으로 적어 주세요."
                            className="w-64 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                          <button
                            type="button"
                            disabled={busy || !(rejectNotes[c.id] ?? '').trim()}
                            onClick={() => handleReject(c)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            반려
                          </button>
                        </div>
                      </div>
                    )}

                    {canClose && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleClose(c)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        마감
                      </button>
                    )}

                    {canSettle && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSettle(c)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        정산 완료 처리
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
