'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  FiChevronDown,
  FiChevronUp,
  FiDollarSign,
  FiEdit2,
  FiExternalLink,
  FiRefreshCw,
} from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import PostContentRenderer from '@/components/PostContentRenderer'
import OptimizedImage from '@/components/OptimizedImage'
import { toReviewDetail, type CampaignDetail } from './reviewDetail'
import SettlementPanel from './SettlementPanel'
import FulfillmentPanel from './FulfillmentPanel'
import ProxyCreatePanel from './ProxyCreatePanel'
import {
  nextStatus,
  PUBLIC_CAMPAIGN_STATUSES,
  type CampaignStatus,
} from '@/lib/funding/transitions'
import {
  feeRateLabel,
  formatFeeRatePercent,
  FEE_RATE_VAT_NOTE,
  MEMBER_FEE_RATE_BP,
  NONMEMBER_FEE_RATE_BP,
} from '@/lib/funding/feeRate'

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
  /**
   * 지금 승인하면 붙을 플랫폼 수수료율. 승인할 수 없는 캠페인에는 없다
   * (서버가 그때만 싣는다). 승인하는 순간 이 값이 캠페인에 새겨지고, 뒤에
   * 설정을 바꿔도 움직이지 않는다.
   */
  fee_preview: { rate_bp: number; is_member: boolean } | null
  /** 승인할 수 있는 캠페인의 제안 주소. 주소 칸을 비우고 승인하면 이 값이 쓰인다. */
  slug_suggestion: string | null
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
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [slugDrafts, setSlugDrafts] = useState<Record<string, string>>({})
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({})
  const [details, setDetails] = useState<Record<string, CampaignDetail>>({})
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  // 관리자가 마지막으로 읽은 판 번호. 목록을 불러올 때 채우고, 상세를 펼치면
  // 그때 읽은 값으로 덮는다 — 승인은 실제로 읽은 판에만 도장을 찍는다.
  const [reviewedVersions, setReviewedVersions] = useState<Record<string, string>>({})

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
      setReviewedVersions(Object.fromEntries(list.map(c => [c.id, c.updated_at])))
      setDetails({})
      // 승인 입력값 초기화: 이미 정식 주소(비-draft-)를 갖고 있으면 미리 채운다.
      setSlugDrafts(prev => {
        const next = { ...prev }
        for (const c of list) {
          if (next[c.id] === undefined) {
            next[c.id] =
              c.slug && !c.slug.startsWith('draft-') && isValidSlugInput(c.slug)
                ? c.slug
                : (c.slug_suggestion ?? '')
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

  /**
   * 캠페인 하나의 본문·리워드를 그때그때 불러온다. 목록 전체를 미리 당겨
   * 오지 않는 이유는 심사 화면에 수십 건이 걸릴 수 있어서다.
   *
   * 새 API를 만들지 않았다 — `GET /api/mypage/funding/campaigns/[id]`가 이미
   * 본문과 리워드를 다 주고, `canManageCampaign`이 `isApprovedActiveAdmin`을
   * 먼저 통과시키므로 관리자도 들어간다.
   */
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/mypage/funding/campaigns/${id}`)
      const json = await res.json()
      if (res.ok === false) throw new Error(json?.error?.message ?? '내용을 불러오지 못했습니다.')
      // 후원자 명단(json.data.pledges)은 상태에 담지도 않는다 —
      // `toReviewDetail`이 싣는 목록을 정한다.
      const detail: CampaignDetail = toReviewDetail(json.data)
      setDetails(prev => ({ ...prev, [id]: detail }))
      if (detail.version) setReviewedVersions(prev => ({ ...prev, [id]: detail.version }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetailLoading(prev => ({ ...prev, [id]: false }))
    }
  }, [])

  function toggleDetail(id: string) {
    const willOpen = !openIds[id]
    setOpenIds(prev => ({ ...prev, [id]: willOpen }))
    if (willOpen && !details[id]) void loadDetail(id)
  }

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
        // 409는 두 가지다 — 다른 관리자가 먼저 처리했거나, 심사 중에 개설자가
        // 내용을 고쳤거나. 서버가 어느 쪽인지 문장으로 말해 주므로 그대로 쓴다.
        setError(
          `${json?.error?.message ?? '상태가 이미 바뀌었습니다. 새로고침해 주세요.'} 목록을 새로고침합니다.`
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
    if (slug && !isValidSlugInput(slug)) {
      setError('주소(slug)는 영문 소문자·숫자·하이픈 3~60자입니다.')
      return
    }
    // 수수료율은 이 버튼을 누르는 순간 캠페인에 새겨져 정산까지 따라간다.
    // 확인 문구에서 한 번 더 말한다 — 화면 위에 적혀 있어도 읽지 않고 누르는
    // 것이 버튼이다.
    const feeLine = campaign.fee_preview
      ? `\n플랫폼 수수료율 ${feeRateLabel(campaign.fee_preview.rate_bp, campaign.fee_preview.is_member)}가 이 캠페인에 고정되며, 나중에 설정을 바꿔도 달라지지 않습니다.`
      : ''
    const ok = window.confirm(
      `"${campaign.title}"을(를) 승인해 /funding/${slug || campaign.slug_suggestion} 주소로 공개합니다.\n조합원이 후원을 시작할 수 있게 됩니다.${feeLine} 계속할까요?`
    )
    if (!ok) return
    void transition(campaign, 'approve', {
      ...(slug ? { slug } : {}),
      reviewedVersion: reviewedVersions[campaign.id] ?? campaign.updated_at,
    })
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
                제출된 캠페인을 승인하면 주소가 확정되고 공개되며, 그 순간 플랫폼 수수료율(조합원{' '}
                {formatFeeRatePercent(MEMBER_FEE_RATE_BP)}% / 비조합원{' '}
                {formatFeeRatePercent(NONMEMBER_FEE_RATE_BP)}%, 둘 다 {FEE_RATE_VAT_NOTE})이
                개설자의 가입 승인 상태에 따라 캠페인에 고정됩니다. 조합원이 아닌 창작자의 캠페인은
                대리 개설로 만듭니다.
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

        <ProxyCreatePanel
          memberRateBp={MEMBER_FEE_RATE_BP}
          nonmemberRateBp={NONMEMBER_FEE_RATE_BP}
          onCreated={campaign => {
            setCreated(campaign)
            setSuccess(null)
            setFilter('draft')
            void load()
          }}
        />
        {created && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            &quot;{created.title}&quot; 초안을 만들었습니다.{' '}
            <a href={`/mypage/funding/${created.id}/edit`} className="font-medium underline">
              편집 화면에서 본문·리워드·표지를 채우고 제출하기
            </a>
          </div>
        )}

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
              const slugValid = slugValue === '' || isValidSlugInput(slugValue)

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
                        {c.status !== 'settled' && (
                          <a
                            href={`/mypage/funding/${c.id}/edit`}
                            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                          >
                            <FiEdit2 className="w-3 h-3" />
                            편집
                          </a>
                        )}
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

                  <div className="pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => toggleDetail(c.id)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-primary-700"
                      aria-expanded={openIds[c.id] === true}
                    >
                      {openIds[c.id] ? (
                        <FiChevronUp className="w-4 h-4" />
                      ) : (
                        <FiChevronDown className="w-4 h-4" />
                      )}
                      본문·리워드 보기
                    </button>
                    {openIds[c.id] && (
                      <div className="mt-3 space-y-4">
                        {detailLoading[c.id] && !details[c.id] ? (
                          <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
                        ) : !details[c.id] ? (
                          <p className="text-sm text-gray-500">내용을 불러오지 못했습니다.</p>
                        ) : (
                          <>
                            <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                                프로젝트 소개
                              </h3>
                              {details[c.id].story.trim() === '' ? (
                                <p className="text-sm text-gray-500">본문이 비어 있습니다.</p>
                              ) : (
                                /* 공개 상세(`/funding/[slug]`)가 쓰는 렌더러를 같은 방식으로
                                   부른다 — 관리자가 보는 것과 후원자가 볼 것이 같아야 한다.
                                   마크다운 라이브러리나 sanitizer를 여기서 새로 들이지
                                   않는다(이 저장소는 SSR에서 jsdom sanitizer로 한 번 데였다). */
                                <PostContentRenderer
                                  content={details[c.id].story}
                                  contentFormat="markdown"
                                />
                              )}
                            </section>
                            <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                                리워드 {details[c.id].rewards.length}개
                              </h3>
                              {details[c.id].rewards.length === 0 ? (
                                <p className="text-sm text-gray-500">리워드가 없습니다.</p>
                              ) : (
                                <ul className="space-y-3">
                                  {details[c.id].rewards.map(r => (
                                    <li
                                      key={r.id}
                                      className="rounded-md border border-gray-200 bg-white p-3"
                                    >
                                      {/* 승인하면 사진은 잠긴다(`rewardLock.ts`).
                                          관리자가 보지 못한 것을 얼리지 않도록
                                          여기서 함께 보여 준다. */}
                                      <div className="mb-2 flex items-start gap-3">
                                        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                                          {r.image_url ? (
                                            <OptimizedImage
                                              src={r.image_url}
                                              alt={`${r.title} 리워드 사진`}
                                              width={80}
                                              height={80}
                                              className="h-full w-full object-cover"
                                              fallbackText={r.title.slice(0, 2)}
                                            />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center px-1 text-center text-xs text-gray-400">
                                              사진 없음
                                            </div>
                                          )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-gray-900">
                                              {r.title}
                                            </span>
                                            <span className="text-sm text-gray-700">
                                              {won(r.amount)}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                              {r.total_quantity === null
                                                ? '수량 무제한'
                                                : `수량 ${r.total_quantity.toLocaleString('ko-KR')}개`}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                              {r.requires_shipping ? '배송 필요' : '배송 없음'}
                                            </span>
                                            {r.requires_credit_name && (
                                              <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                                이름 기재
                                              </span>
                                            )}
                                            {r.estimated_delivery && (
                                              <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                                예상 전달 {r.estimated_delivery}
                                              </span>
                                            )}
                                          </div>
                                          {r.description && (
                                            <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
                                              {r.description}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 후원을 받기 시작한 뒤부터 이행과 환불이 생긴다. 개설자가
                      후원 전부를 한 번에 '발송 완료'로 눌러도 오늘 남는 것은
                      활동 기록 한 줄뿐이라 아무도 읽지 않는다 — 그 줄을 여기서
                      보이게 하고, 되돌리기와 사무국 대리 환불을 같은 자리에
                      둔다. 접힌 채로 그려지므로 목록을 여는 것만으로 캠페인마다
                      조회가 나가지는 않는다. */}
                  {(c.status === 'active' || c.status === 'closed' || c.status === 'settled') && (
                    <div className="pt-2">
                      <FulfillmentPanel campaignId={c.id} />
                    </div>
                  )}

                  {/* 마감 뒤에는 정산이 이어진다. '정산 완료 처리'는 지급까지
                      기록된 정산서가 있어야 통과하므로(서버가 판정한다) 그
                      정산서를 만드는 자리를 버튼 바로 위에 둔다. */}
                  {(c.status === 'closed' || c.status === 'settled') && (
                    <div className="pt-2">
                      <SettlementPanel
                        campaignId={c.id}
                        campaignTitle={c.title}
                        onSettled={() => void load()}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-gray-100">
                    {canApprove && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-600">
                          공개 주소(slug, 선택) — /funding/
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={slugValue}
                            disabled={busy}
                            onChange={e =>
                              setSlugDrafts(prev => ({ ...prev, [c.id]: e.target.value.trim() }))
                            }
                            placeholder={c.slug_suggestion ?? '예: our-first-album'}
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
                              ? `공개 주소: /funding/${slugValue} — 고치지 않아도 됩니다.`
                              : '영문 소문자·숫자·하이픈 3~60자로 입력해 주세요.'
                            : `비워 두면 /funding/${c.slug_suggestion ?? '(추천 주소)'}로 공개됩니다.`}
                        </p>
                        {/* 승인하면 요율이 이 캠페인에 새겨지고 정산까지
                            따라간다. 정산 화면에서 처음 알게 두지 않는다. */}
                        {c.fee_preview && (
                          <p className="text-xs text-gray-600">
                            적용 요율{' '}
                            <span className="font-semibold text-gray-900">
                              {feeRateLabel(c.fee_preview.rate_bp, c.fee_preview.is_member)}
                            </span>{' '}
                            — 개설자의 조합 가입이{' '}
                            {c.fee_preview.is_member
                              ? '승인·활성 상태라 조합원 요율입니다.'
                              : '승인·활성 상태가 아니라 비조합원 요율입니다.'}{' '}
                            승인하는 순간 고정되며 나중에 설정을 바꿔도 달라지지 않습니다.
                          </p>
                        )}
                        {c.fee_preview?.is_member === false && (
                          <p className="text-xs text-amber-700">
                            캠페인 개설은 승인·활성 조합원만 할 수 있어 비조합원 요율(
                            {feeRateLabel(NONMEMBER_FEE_RATE_BP, false)})이 붙는 일은 보통 없습니다.
                            이 캠페인은 개설한 뒤 승인 전에 조합원 자격이 풀린 경우이니, 승인하기
                            전에 사무국이 사정을 확인해 주세요.
                          </p>
                        )}
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
