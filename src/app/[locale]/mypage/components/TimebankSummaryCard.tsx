'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FiClock } from 'react-icons/fi'
import DashboardCard from './DashboardCard'
import { formatTimebankMinutes, timebankFetch } from '@/components/timebank/timebankFormat'

/** `GET /api/timebank/me`(`summarizeMe`) 중 이 카드가 쓰는 칸. */
type MeSummary = {
  enabled: boolean
  balance_minutes: number
  pending: { to_confirm: number; awaiting_other: number }
  terms: { needs_agreement: boolean }
}

/**
 * 마이페이지 첫 화면의 타임뱅크 카드 — **클라이언트 섬**(스펙 §8). 허브
 * (`mypage/page.tsx`)는 데이터를 받지 않는 정적 서버 컴포넌트로 남고, 이 카드만
 * 브라우저에서 `/api/timebank/me`를 부른다.
 *
 * 불러오기 전·실패·꺼짐·미동의면 기본 문구의 카드를 그린다. 어느 경우든 카드는
 * `/mypage/timebank`로 간다 — 그 화면이 상태별 안내(`TimebankGate`)를 맡는다.
 */
export default function TimebankSummaryCard() {
  const t = useTranslations('mypage')
  const tb = useTranslations('timebank')
  const [me, setMe] = useState<MeSummary | null>(null)

  useEffect(() => {
    let alive = true
    void timebankFetch<MeSummary>('/api/timebank/me').then(result => {
      if (alive && result.ok) setMe(result.data)
    })
    return () => {
      alive = false
    }
  }, [])

  const ready = me !== null && me.enabled && !me.terms.needs_agreement
  const description = ready
    ? t('timebankCardBalance', { balance: formatTimebankMinutes(tb, me.balance_minutes) })
    : me !== null && me.enabled && me.terms.needs_agreement
      ? t('timebankCardNeedsAgreement')
      : t('timebankCardDesc')
  const badge =
    ready && me.pending.to_confirm > 0
      ? t('timebankCardPending', { count: me.pending.to_confirm })
      : undefined

  return (
    <div data-testid="timebank-summary-card" data-state={ready ? 'ready' : 'default'}>
      <DashboardCard
        title={t('timebankCardTitle')}
        description={description}
        icon={<FiClock className="w-8 h-8 text-violet-600" />}
        href="/mypage/timebank"
        buttonText={t('timebankCardButton')}
        badge={badge}
      />
    </div>
  )
}
