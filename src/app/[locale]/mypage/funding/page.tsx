'use client'

/**
 * 내가 후원한 프로젝트. 마이페이지 예매 내역(`../tickets/page.tsx`)과 같은 틀이다.
 *
 * 이 화면은 **후원자 관점만** 그린다. 내가 연 캠페인 목록은 창작자 화면(2부-B)의
 * 몫이라 API가 함께 주는 `campaigns`는 여기서 쓰지 않는다.
 */

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link } from '@/i18n/navigation'

import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'
import { formatAmount } from '../../funding/format'

// 서버 화이트리스트(`toPublicPledgeFields` + 라우트가 얹는 campaign_id)와 정확히
// 맞춘다 — 여기 없는 필드는 서버가 보내지 않으므로 화면에서도 쓸 수 없다.
interface MyPledge {
  pledge_code: string
  status: string
  reward_title: string
  quantity: number
  total_amount: number
  paid_at: string | null
  campaign_id: string
}

export default function MyFundingPage() {
  const t = useTranslations('funding')
  const [pledges, setPledges] = useState<MyPledge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <p className="text-gray-600">{t('common.loading')}</p>
        ) : pledges.length === 0 ? (
          <div className="rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-600">{t('mypage.empty')}</p>
            <Link href="/funding" className="tw-btn-primary mt-4 inline-flex">
              {t('mypage.browse')}
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {pledges.map(p => (
              <li key={p.pledge_code} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900">
                      {p.reward_title} × {p.quantity}
                    </p>
                    <p className="mt-1 font-mono text-xs text-gray-500">{p.pledge_code}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {t('progress.amount', { amount: formatAmount(p.total_amount, 'ko') })}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{t(`status.${p.status}`)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </MypageLayout>
    </PermissionCheck>
  )
}
