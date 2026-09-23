'use client'

/**
 * 내가 후원한 프로젝트, 그리고 내가 연 캠페인. 마이페이지 예매 내역
 * (`../tickets/page.tsx`)과 같은 틀이다.
 *
 * 후원 구역을 먼저 그리고 캠페인 구역을 그 아래에 둔다 — 이 화면에 오는
 * 대부분은 후원자이지 창작자가 아니다.
 *
 * **여기서 후원을 취소하는 버튼은 만들지 않는다.** 취소 라우트
 * (`/api/funding/pledges/cancel`)는 후원번호+이메일로 본인을 확인하는
 * 비회원 경로만 짜여 있고, 로그인 세션으로 본인 확인을 하는 분기는 서버에
 * 없다 — 만들어도 지금은 어느 화면에서도 부를 수 없다. 회원 취소 버튼을
 * 여기 붙일지, 아니면 서버 쪽을 아예 안 만들지는 후속 과제다. 잊혀서 빠진
 * 게 아니라, 이번 리뷰 범위 밖이라 남겨 둔 결정이다.
 */

import { Link } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'
import { computePercent, formatAmount, hasBackers } from '@/app/[locale]/funding/format'
// 공개 링크를 걸어도 되는 상태만 — 심사 중·초안은 공개 화면에서 404가 난다.
// 목록·대시보드·공개 화면이 같은 목록을 봐야 하므로 전이 표에 있는 정본을
// 그대로 쓴다(사본을 두면 한쪽만 늘어난다).
import { PUBLIC_CAMPAIGN_STATUSES } from '@/lib/funding/transitions'

import CampaignStatusBadge from './CampaignStatusBadge'

// 서버 화이트리스트(`toPublicPledgeFields` + 라우트가 얹는 campaign_id·
// campaign_slug)와 정확히 맞춘다 — 여기 없는 필드는 서버가 보내지 않으므로
// 화면에서도 쓸 수 없다.
interface MyPledge {
  pledge_code: string
  status: string
  reward_title: string
  quantity: number
  total_amount: number
  paid_at: string | null
  campaign_id: string
  campaign_slug: string | null
}

// 서버가 `listCampaignsByOwner` + `getCampaignProgress`로 내보내는 필드 중
// 이 화면에서 실제로 쓰는 것만 적는다.
interface MyCampaign {
  id: string
  slug: string
  status: string
  title: string
  goal_amount: number
  progress: { raised_amount: number; backer_count: number }
}

export default function MyFundingPage() {
  const t = useTranslations('funding')
  const locale = useLocale()
  const [pledges, setPledges] = useState<MyPledge[]>([])
  const [campaigns, setCampaigns] = useState<MyCampaign[]>([])
  // 기능 스위치(`funding_features.enabled`). 꺼져 있으면 개설 구역을 통째로
  // 감춘다 — 버튼을 눌러 폼을 다 채운 뒤에 "펀딩을 준비 중입니다"를 만나는
  // 것보다 아예 보이지 않는 편이 정직하다. 서버가 알려 주기 전까지는 꺼진
  // 것으로 본다(라우트의 기본값과 같다).
  const [creatorEnabled, setCreatorEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLDivElement | null>(null)

  // 다른 펀딩 화면(조회·후원 폼)과 같은 규칙 — 배너가 뜨는 순간 포커스를
  // 옮긴다. 스크린리더가 놓치지 않게, 그리고 눈으로 보는 사람도 목록이 왜
  // 비었는지 배너를 보고 알 수 있게.
  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/mypage/funding')
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(t('error.body'))
        return
      }
      setPledges((body.data?.pledges ?? []) as MyPledge[])
      setCampaigns((body.data?.campaigns ?? []) as MyCampaign[])
      setCreatorEnabled(body.data?.funding_enabled === true)
    } catch {
      setError(t('error.body'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title={t('mypage.title')} description={t('mypage.description')}>
        {error ? (
          <div
            ref={errorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 outline-none"
          >
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <p className="text-gray-600">{t('common.loading')}</p>
        ) : !error && pledges.length === 0 ? (
          <div className="rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-600">{t('mypage.empty')}</p>
            <Link href="/funding" className="tw-btn-primary mt-4 inline-flex">
              {t('mypage.browse')}
            </Link>
          </div>
        ) : pledges.length > 0 ? (
          <ul className="space-y-3">
            {pledges.map(p => (
              <li key={p.pledge_code} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {p.campaign_slug ? (
                      <Link
                        href={`/funding/${p.campaign_slug}`}
                        className="font-medium text-primary-600 hover:underline"
                      >
                        {p.reward_title} × {p.quantity}
                      </Link>
                    ) : (
                      <p className="font-medium text-gray-900">
                        {p.reward_title} × {p.quantity}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-xs text-gray-500">{p.pledge_code}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {t('progress.amount', { amount: formatAmount(p.total_amount, locale) })}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{t(`status.${p.status}`)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-6 text-sm text-gray-500">
          {t.rich('mypage.manageNotice', {
            manage: chunks => <Link href="/funding/manage">{chunks}</Link>,
          })}
        </p>

        {/* 스위치가 꺼져 있으면 개설 구역 자체가 없다 — 후원 내역은 위에
            그대로 남는다. */}
        {creatorEnabled ? (
          <section className="mt-10 border-t border-gray-200 pt-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('creator.myCampaigns')}</h2>
              <Link href="/mypage/funding/new" className="tw-btn-primary">
                {t('creator.newCampaign')}
              </Link>
            </div>

            {!loading && campaigns.length === 0 ? (
              <div className="mt-4 rounded-lg border border-gray-200 p-8 text-center">
                <p className="text-gray-600">{t('creator.noCampaigns')}</p>
                <Link href="/mypage/funding/new" className="tw-btn-primary mt-4 inline-flex">
                  {t('creator.newCampaign')}
                </Link>
              </div>
            ) : campaigns.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {campaigns.map(c => {
                  const percent = computePercent(c.progress.raised_amount, c.goal_amount)
                  // 후원이 하나도 없으면 0원·0%가 아니라 목표 금액을 적는다 —
                  // 운영 대시보드와 같은 규칙이다(`hasBackers`).
                  const showFigures = hasBackers(c.progress)
                  const canLinkPublic = (PUBLIC_CAMPAIGN_STATUSES as readonly string[]).includes(
                    c.status
                  )
                  return (
                    <li key={c.id} className="rounded-lg border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900">{c.title}</p>
                            <CampaignStatusBadge status={c.status} />
                          </div>
                          <p className="mt-1 text-sm text-gray-600">
                            {showFigures ? (
                              <>
                                {t('progress.amount', {
                                  amount: formatAmount(c.progress.raised_amount, locale),
                                })}
                                {' · '}
                                {t('list.percent', { percent })}
                              </>
                            ) : (
                              t('progress.goal', { goal: formatAmount(c.goal_amount, locale) })
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
                          {canLinkPublic ? (
                            <Link
                              href={`/funding/${c.slug}`}
                              className="text-primary-600 hover:underline"
                            >
                              {t('creator.openPublic')}
                            </Link>
                          ) : null}
                          <Link
                            href={`/mypage/funding/${c.id}`}
                            className="text-primary-600 hover:underline"
                          >
                            {t('creator.manage')}
                          </Link>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </section>
        ) : null}
      </MypageLayout>
    </PermissionCheck>
  )
}
