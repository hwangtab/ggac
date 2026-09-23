'use client'

/**
 * 펀딩 개설. 만들면 곧바로 편집기로 보낸다 — 여기서는 되돌리기 어려운 것만 받는다.
 *
 * 제목·한 줄 소개·목표 금액 셋이면 초안이 선다. 이야기와 리워드는 편집기에서
 * 채운다. 한 화면에 다 받으면 중간에 이탈했을 때 아무것도 남지 않는다.
 *
 * 개설자 약관 동의는 **체크박스로 받는다.** 후원자 쪽 고지와 다른 이유는,
 * 창작자는 조합과 정산·수수료·발송 책임을 지는 당사자라 동의 사실 자체가
 * 기록으로 남아야 하기 때문이다(서버가 `terms_version`에 새긴다).
 */

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link, useRouter } from '@/i18n/navigation'

import MypageLayout from '../../components/MypageLayout'
import PermissionCheck from '../../components/PermissionCheck'

const CATEGORIES = ['공연', '음반', '전시', '출판', '영상', '기타'] as const

export default function NewCampaignPage() {
  const t = useTranslations('funding')
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [goal, setGoal] = useState('')
  const [category, setCategory] = useState<string>('기타')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ block: 'center' })
    }
  }, [error])

  const submit = useCallback(async () => {
    setError('')
    if (!title.trim()) {
      setError(t('creator.errorTitle'))
      return
    }
    if (!summary.trim()) {
      setError(t('creator.errorSummary'))
      return
    }
    const goalNumber = Number(goal.replace(/[^0-9]/g, ''))
    if (!Number.isSafeInteger(goalNumber) || goalNumber <= 0) {
      setError(t('creator.errorGoal'))
      return
    }
    if (!agreed) {
      setError(t('creator.errorTerms'))
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/mypage/funding/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim(),
          goal_amount: goalNumber,
          category,
          agreedCreatorTerms: true,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.data?.campaign) {
        setError(body?.error || t('creator.errorCreate'))
        return
      }
      // 만들자마자 편집기로 보낸다 — 초안만 있고 아무것도 못 채운 상태로
      // 목록에 덩그러니 놓이면 무엇을 해야 하는지 알기 어렵다.
      router.push(`/mypage/funding/${body.data.campaign.id}/edit`)
    } catch {
      setError(t('creator.errorCreate'))
    } finally {
      setSaving(false)
    }
  }, [title, summary, goal, category, agreed, t, router])

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title={t('creator.newTitle')} description={t('creator.newDescription')}>
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

        <div className="space-y-5">
          <div>
            <label htmlFor="title" className="mb-2 block text-sm font-medium text-gray-900">
              {t('creator.title')}
            </label>
            <input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              required
            />
          </div>

          <div>
            <label htmlFor="summary" className="mb-2 block text-sm font-medium text-gray-900">
              {t('creator.summary')}
            </label>
            <input
              id="summary"
              value={summary}
              onChange={e => setSummary(e.target.value.slice(0, 200))}
              maxLength={200}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              required
            />
            <p className="mt-1 text-xs text-gray-500">{t('creator.summaryHelp')}</p>
          </div>

          <div>
            <label htmlFor="goal" className="mb-2 block text-sm font-medium text-gray-900">
              {t('creator.goal')}
            </label>
            <input
              id="goal"
              value={goal}
              onChange={e => {
                const digits = e.target.value.replace(/[^0-9]/g, '')
                // 입력 중엔 숫자를 깎지 않는다 — 표시용 콤마만 붙인다. 정규화(상한·
                // 반올림)는 제출 시점에 한다(후원 폼의 추가 후원금과 같은 이유).
                setGoal(digits === '' ? '' : Number(digits).toLocaleString('ko-KR'))
              }}
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              required
            />
            <p className="mt-1 text-xs text-gray-500">{t('creator.goalHelp')}</p>
          </div>

          <div>
            <label htmlFor="category" className="mb-2 block text-sm font-medium text-gray-900">
              {t('creator.category')}
            </label>
            <select
              id="category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="h-4 w-4"
            />
            {t('creator.agreeTerms')}
          </label>
          <p className="-mt-3 text-xs text-gray-500">
            <Link href="/funding/terms" className="text-primary-600 hover:underline">
              {t('creator.agreeTermsLink')}
            </Link>
          </p>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="w-full rounded-lg bg-primary-600 px-5 py-3 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? t('creator.creating') : t('creator.create')}
          </button>
        </div>
      </MypageLayout>
    </PermissionCheck>
  )
}
