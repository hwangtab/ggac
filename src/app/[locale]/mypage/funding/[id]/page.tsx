'use client'

/**
 * 펀딩 운영 대시보드. 창작자가 캠페인을 만든 뒤 가장 자주 오는 곳이다.
 *
 * **지금 무엇을 해야 하는가**를 맨 위에서 한 줄로 말해 준다 — 상태별로
 * 문구가 갈리고, 반려된 뒤 다시 초안으로 돌아왔으면 관리자가 남긴 반려
 * 사유(`campaign.review_note`)를 그대로 보인다.
 *
 * 마감 뒤에는 **리워드 이행**이 여기서 이어진다. 후원을 골라 준비 중·발송
 * 완료·전달 완료로 옮기고, 배송 목록을 파일로 내려받는다. 고른 건수를 문장에
 * 넣어 먼저 묻는다 — 되돌릴 수 없고 후원자에게 메일이 나가는 동작이다
 * (회원 관리 화면의 대량 작업과 같은 모양: 명시적 선택 + 건수를 말하는 확인).
 *
 * 동작 버튼(심사 올리기·제출 취소·마감하기)은 전부 `POST …/transition`에
 * `{ action }`을 보낸다. 되돌릴 수 없는 둘(심사 올리기·마감하기)만
 * `window.confirm`으로 먼저 묻는다. 서버가 거절하면 그 문장을 그대로
 * 배너에 보인다 — 화면이 이유를 따로 추측하지 않는다.
 */

import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'
import { computePercent, formatAmount, hasBackers } from '@/app/[locale]/funding/format'
// 공개 링크를 걸어도 되는 상태 — 목록 화면과 같은 기준을 사본이 아니라
// 전이 표의 정본으로 쓴다.
import { PUBLIC_CAMPAIGN_STATUSES } from '@/lib/funding/transitions'
// 이행 전이 규칙의 정본. 화면은 물어보고만 움직인다 — 라우트가 다시 판정한다.
import { isFulfillableCampaignStatus, type FulfillmentStatus } from '@/lib/funding/fulfillment'

import MypageLayout from '../../components/MypageLayout'
import PermissionCheck from '../../components/PermissionCheck'
import CampaignStatusBadge from '../CampaignStatusBadge'

type TransitionAction = 'submit' | 'withdraw' | 'close'

// GET /api/mypage/funding/campaigns/[id] 응답 중 이 화면이 쓰는 필드만.
interface Campaign {
  id: string
  slug: string
  title: string
  status: string
  goal_amount: number
  review_note: string | null
}

interface Progress {
  raised_amount: number
  backer_count: number
}

// 서버 화이트리스트(`ownerPledgeView`)와 정확히 맞춘다 — 배송 필드는
// 배송이 필요한 리워드 건에만 실려 온다.
interface OwnerPledge {
  id: string
  pledge_code: string
  reward_title: string
  quantity: number
  total_amount: number
  backer_name: string
  // 익명 후원은 `backer_name`이 '익명'으로 바뀌어 온다. 배송이 필요한
  // 리워드라면 그것만으로는 택배를 부칠 수 없으므로, 서버가 함께 보내는
  // 받는 사람 이름을 배송지 칸에 적는다 — 익명은 공개 화면의 표기를 감추는
  // 약속이지, 물건을 부치는 사람에게 수취인을 감추는 약속이 아니다.
  shipping_name?: string
  shipping_address1?: string
  shipping_address2?: string
  shipping_postcode?: string
  fulfillment_status: FulfillmentStatus
}

interface DashboardData {
  campaign: Campaign
  progress: Progress
  pledges: OwnerPledge[]
  edit_scope: 'all' | 'contentOnly' | 'none'
  is_admin: boolean
}

function nextLineKey(status: string): string | null {
  switch (status) {
    case 'draft':
      return 'creator.nextDraft'
    case 'submitted':
      return 'creator.nextSubmitted'
    case 'active':
      return 'creator.nextActive'
    case 'closed':
      return 'creator.nextClosed'
    case 'settled':
      return 'creator.nextSettled'
    default:
      return null
  }
}

function fulfillmentLabelKey(status: FulfillmentStatus): string {
  switch (status) {
    case 'preparing':
      return 'creator.fulfillmentPreparing'
    case 'shipped':
      return 'creator.fulfillmentShipped'
    case 'delivered':
      return 'creator.fulfillmentDelivered'
    default:
      return 'creator.fulfillmentNone'
  }
}

function shippingAddress(p: OwnerPledge): string {
  if (!p.shipping_address1) return ''
  const parts = [p.shipping_postcode, p.shipping_address1, p.shipping_address2].filter(Boolean)
  return parts.join(' ')
}

export default function ManageCampaignPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const t = useTranslations('funding')
  const locale = useLocale()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<TransitionAction | null>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/mypage/funding/campaigns/${id}`)
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.data?.campaign) {
        setError(t('creator.errorLoad'))
        return
      }
      setData(body.data as DashboardData)
    } catch {
      setError(t('creator.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  const runTransition = useCallback(
    async (action: TransitionAction) => {
      const confirmKey =
        action === 'submit'
          ? 'creator.confirmSubmit'
          : action === 'close'
            ? 'creator.confirmClose'
            : null
      if (confirmKey && !window.confirm(t(confirmKey))) return
      setError('')
      setBusy(action)
      try {
        const res = await fetch(`/api/mypage/funding/campaigns/${id}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const body = await res.json().catch(() => null)
        if (res.ok === false) {
          setError(body?.error || t('creator.errorTransition'))
          return
        }
        // 상태가 바뀌었으니 화면을 서버 값으로 다시 맞춘다.
        await load()
      } catch {
        setError(t('creator.errorTransition'))
      } finally {
        setBusy(null)
      }
    },
    [id, t, load]
  )

  // ---------------------------------------------------------------- 이행

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fulfilling, setFulfilling] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const toggleOne = useCallback((pledgeId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(pledgeId)) next.delete(pledgeId)
      else next.add(pledgeId)
      return next
    })
  }, [])

  /** 머리글 체크박스. 전부 고르거나 전부 푼다 — 고르기만으로는 아무 일도
   *  일어나지 않고, 실제 동작은 건수를 말하는 확인을 한 번 더 지난다. */
  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const rows = data?.pledges ?? []
      if (rows.length > 0 && rows.every(p => prev.has(p.id))) return new Set<string>()
      return new Set(rows.map(p => p.id))
    })
  }, [data])

  const runFulfillment = useCallback(
    async (to: FulfillmentStatus) => {
      const ids = [...selected]
      if (ids.length === 0) {
        setNotice('')
        setError(t('creator.fulfillmentNoSelection'))
        return
      }
      const confirmKey =
        to === 'preparing'
          ? 'creator.confirmPreparing'
          : to === 'shipped'
            ? 'creator.confirmShipped'
            : to === 'delivered'
              ? 'creator.confirmDelivered'
              : 'creator.confirmNone'
      if (!window.confirm(t(confirmKey, { count: ids.length }))) return
      setError('')
      setNotice('')
      setFulfilling(true)
      try {
        const res = await fetch(`/api/mypage/funding/campaigns/${id}/fulfillment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, pledge_ids: ids }),
        })
        const body = await res.json().catch(() => null)
        if (res.ok === false) {
          // 409(일부만 바뀜)는 서버가 몇 건이 빠졌는지까지 적어 보낸다 —
          // 화면이 이유를 추측하지 않고 그 문장을 그대로 보인다.
          setError(body?.error || t('creator.errorFulfillment'))
          setSelected(new Set())
          await load()
          return
        }
        setSelected(new Set())
        await load()
        setNotice(
          t('creator.fulfillmentDone', { count: Number(body?.data?.updated ?? ids.length) })
        )
      } catch {
        setError(t('creator.errorFulfillment'))
      } finally {
        setFulfilling(false)
      }
    },
    [id, selected, t, load]
  )

  const campaign = data?.campaign
  const canLinkPublic =
    !!campaign && (PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)
  const rejected = campaign?.status === 'draft' && !!campaign.review_note
  const showFigures = data ? hasBackers(data.progress) : false
  const percent = data ? computePercent(data.progress.raised_amount, data.campaign.goal_amount) : 0
  // 후원을 받기 시작한 뒤(active·closed·settled)에만 이행을 움직인다 —
  // 판정은 전이 표가 하고 라우트가 다시 한다.
  const canFulfil = !!campaign && isFulfillableCampaignStatus(campaign.status)
  const allSelected =
    !!data && data.pledges.length > 0 && data.pledges.every(p => selected.has(p.id))

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title={t('creator.manageTitle')}>
        {error ? (
          <div
            ref={errorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 outline-none"
          >
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div
            ref={noticeRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 outline-none"
          >
            {notice}
          </div>
        ) : null}

        {loading ? (
          <p className="text-gray-600">{t('common.loading')}</p>
        ) : !campaign ? (
          // 잘못 적은 주소·남의 캠페인·지워진 캠페인은 모두 같은 응답이라
          // 여기로 온다. 배너만 남기면 나갈 길이 없다 — 편집기의
          // `readOnlyGuidance` 블록과 같은 모양으로 돌아갈 길과 재시도를 준다.
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-900">{t('creator.loadFailedGuidance')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setLoading(true)
                  void load()
                }}
                className="tw-btn-secondary"
              >
                {t('error.retry')}
              </button>
              <Link href="/mypage/funding" className="text-sm text-primary-600 hover:underline">
                {t('creator.backToList')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{campaign.title}</h1>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            {canLinkPublic ? (
              <Link
                href={`/funding/${campaign.slug}`}
                className="mt-1 inline-block text-sm text-primary-600 hover:underline"
              >
                {t('creator.openPublic')}
              </Link>
            ) : null}

            <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
              {rejected ? (
                <p className="text-sm text-gray-900">
                  <span className="font-semibold text-red-700">{t('creator.rejected')}</span>
                  {' — '}
                  {t('creator.rejectedReason')}: {campaign.review_note}
                </p>
              ) : (
                <p className="text-sm text-gray-900">
                  {(() => {
                    const key = nextLineKey(campaign.status)
                    return key ? t(key) : null
                  })()}
                </p>
              )}
            </div>

            {data ? (
              <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {showFigures ? (
                  <>
                    <div>
                      <dt className="text-xs text-gray-500">{t('progress.raised')}</dt>
                      <dd className="font-semibold text-gray-900">
                        {t('progress.amount', {
                          amount: formatAmount(data.progress.raised_amount, locale),
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">{t('progress.percent')}</dt>
                      <dd className="font-semibold text-gray-900">
                        {t('progress.percentValue', { percent })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">{t('progress.backersLabel')}</dt>
                      <dd className="font-semibold text-gray-900">
                        {t('progress.backers', { count: data.progress.backer_count })}
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt className="text-xs text-gray-500">{t('creator.goal')}</dt>
                    <dd className="font-semibold text-gray-900">
                      {t('progress.goal', { goal: formatAmount(campaign.goal_amount, locale) })}
                    </dd>
                  </div>
                )}
              </dl>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {data && data.edit_scope !== 'none' ? (
                <Link href={`/mypage/funding/${id}/edit`} className="tw-btn-secondary">
                  {t('creator.edit')}
                </Link>
              ) : null}
              {campaign.status === 'draft' ? (
                <button
                  type="button"
                  onClick={() => void runTransition('submit')}
                  disabled={busy !== null}
                  className="tw-btn-primary disabled:opacity-50"
                >
                  {t('creator.submit')}
                </button>
              ) : null}
              {campaign.status === 'submitted' ? (
                <button
                  type="button"
                  onClick={() => void runTransition('withdraw')}
                  disabled={busy !== null}
                  className="tw-btn-secondary disabled:opacity-50"
                >
                  {t('creator.withdraw')}
                </button>
              ) : null}
              {campaign.status === 'active' ? (
                <button
                  type="button"
                  onClick={() => void runTransition('close')}
                  disabled={busy !== null}
                  className="tw-btn-secondary disabled:opacity-50"
                >
                  {t('creator.close')}
                </button>
              ) : null}
            </div>

            <section className="mt-10 border-t border-gray-200 pt-8">
              <h2 className="text-lg font-semibold text-gray-900">{t('creator.backers')}</h2>
              {data && data.pledges.length === 0 ? (
                <p className="mt-3 text-gray-600">{t('creator.noBackers')}</p>
              ) : data ? (
                <>
                  {canFulfil ? (
                    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {t('creator.fulfillmentHeading')}
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">{t('creator.fulfillmentHelp')}</p>
                      <p className="mt-3 text-sm text-gray-700" aria-live="polite">
                        {t('creator.selectedCount', { count: selected.size })}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void runFulfillment('preparing')}
                          disabled={fulfilling || selected.size === 0}
                          className="tw-btn-secondary disabled:opacity-50"
                        >
                          {t('creator.markPreparing')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runFulfillment('shipped')}
                          disabled={fulfilling || selected.size === 0}
                          className="tw-btn-primary disabled:opacity-50"
                        >
                          {t('creator.markShipped')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runFulfillment('delivered')}
                          disabled={fulfilling || selected.size === 0}
                          className="tw-btn-secondary disabled:opacity-50"
                        >
                          {t('creator.markDelivered')}
                        </button>
                        {/* 되돌리기는 사무국만 할 수 있다. 다른 사람에게는
                            눌러도 거절당할 버튼을 아예 보이지 않는다. */}
                        {data.is_admin ? (
                          <button
                            type="button"
                            onClick={() => void runFulfillment('none')}
                            disabled={fulfilling || selected.size === 0}
                            className="tw-btn-secondary disabled:opacity-50"
                          >
                            {t('creator.markNone')}
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-4 border-t border-gray-200 pt-3">
                        <a
                          href={`/api/mypage/funding/campaigns/${id}/shipping-export`}
                          className="text-sm font-medium text-primary-600 hover:underline"
                        >
                          {t('creator.exportShipping')}
                        </a>
                        <p className="mt-1 text-xs text-gray-500">
                          {t('creator.exportShippingHelp')}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500">
                          {canFulfil ? (
                            <th className="py-2 pr-3 font-medium">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={toggleAll}
                                aria-label={t('creator.selectAllPledges')}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                            </th>
                          ) : null}
                          <th className="py-2 pr-4 font-medium">{t('creator.backerName')}</th>
                          <th className="py-2 pr-4 font-medium">{t('creator.backerReward')}</th>
                          <th className="py-2 pr-4 font-medium">{t('creator.backerAmount')}</th>
                          <th className="py-2 pr-4 font-medium">{t('creator.backerShipping')}</th>
                          <th className="py-2 pr-4 font-medium">
                            {t('creator.backerFulfillment')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pledges.map(p => (
                          <tr key={p.id} className="border-b border-gray-100 last:border-0">
                            {canFulfil ? (
                              <td className="py-2 pr-3">
                                <input
                                  type="checkbox"
                                  checked={selected.has(p.id)}
                                  onChange={() => toggleOne(p.id)}
                                  aria-label={t('creator.selectPledge', { name: p.backer_name })}
                                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                              </td>
                            ) : null}
                            <td className="py-2 pr-4 text-gray-900">{p.backer_name}</td>
                            <td className="py-2 pr-4 text-gray-700">
                              {p.reward_title} × {p.quantity}
                            </td>
                            <td className="py-2 pr-4 text-gray-900">
                              {t('progress.amount', {
                                amount: formatAmount(p.total_amount, locale),
                              })}
                            </td>
                            <td className="py-2 pr-4 text-gray-700">
                              {p.shipping_address1 ? (
                                <>
                                  {p.shipping_name ? (
                                    <span className="block text-gray-900">{p.shipping_name}</span>
                                  ) : null}
                                  <span>{shippingAddress(p)}</span>
                                </>
                              ) : null}
                            </td>
                            <td className="py-2 pr-4 text-gray-700">
                              {t(fulfillmentLabelKey(p.fulfillment_status))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>
          </>
        )}
      </MypageLayout>
    </PermissionCheck>
  )
}
