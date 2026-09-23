'use client'

/**
 * 펀딩 편집기 껍데기. 대시보드(`../page.tsx`)의 "편집" 링크가 오는 곳이다.
 *
 * 껍데기가 지는 책임 넷 — 자세한 이유는 각 자리의 주석에 있다.
 * 1. 캠페인을 한 번 불러와 세 탭에 나눠 준다
 * 2. 탭 셋을 전부 렌더하고 `hidden`으로만 감춘다(아래 탭 전환부 참고)
 * 3. `edit_scope`를 탭에 내려보내 잠금·안내 문구를 맞춘다
 * 4. 저장하지 않은 변경을 추적해 `beforeunload`로 경고한다
 *
 * 저장 성공 배너가 사라지는 사고를 여기서 다시 만들지 않는다 — 저장 뒤
 * 별도로 다시 불러오지 않고, PATCH 응답이 돌려준 캠페인 값을 그대로
 * 화면 상태에 반영한다. "성공 안내를 띄운 다음 refetch를 부르는" 순서
 * 자체가 없으므로, refetch 첫 줄이 안내를 지우는 경합이 애초에 생기지 않는다.
 */

import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiAlertCircle } from 'react-icons/fi'

import { Link, useRouter } from '@/i18n/navigation'

import MypageLayout from '../../../components/MypageLayout'
import PermissionCheck from '../../../components/PermissionCheck'
import CampaignStatusBadge from '../../CampaignStatusBadge'
import BasicInfoTab, { type BasicInfoValues } from './BasicInfoTab'
import StoryTab from './StoryTab'
import RewardsTab, { type RewardRow } from './RewardsTab'
import { parseGoalAmountDisplay, toDateInputValue } from './basicInfoValidation'

type EditScope = 'all' | 'contentOnly' | 'none'
type TabKey = 'basic' | 'story' | 'rewards'
const TAB_ORDER: TabKey[] = ['basic', 'story', 'rewards']

// GET /api/mypage/funding/campaigns/[id] 응답 중 이 화면이 쓰는 필드만.
interface CampaignFull {
  id: string
  slug: string
  status: string
  title: string
  summary: string
  story: string
  category: string
  goal_amount: number
  start_at: string | null
  end_at: string | null
  cover_image: string | null
}

interface EditorData {
  campaign: CampaignFull
  rewards: RewardRow[]
  edit_scope: EditScope
}

function campaignToBasicValues(c: CampaignFull): BasicInfoValues {
  return {
    title: c.title ?? '',
    summary: c.summary ?? '',
    category: c.category ?? '기타',
    goal_amount: c.goal_amount ? Number(c.goal_amount).toLocaleString('ko-KR') : '',
    start_at: toDateInputValue(c.start_at),
    end_at: toDateInputValue(c.end_at),
    cover_image: c.cover_image ?? '',
  }
}

/** `all`에서 바꿀 수 있는 기본 정보 필드. `contentOnly`는 서버 계약
 * (`CONTENT_ONLY_FIELDS`)과 맞춰 소개·마감일·표지 이미지만 남긴다 —
 * `start_at`은 그 목록에 없어 함께 잠근다(안 잠그면 안 바꿔도 PATCH
 * 본문에 실려 나가 저장 전체가 거절된다). */
const BASIC_FIELDS_BY_SCOPE: Record<'all' | 'contentOnly', (keyof BasicInfoValues)[]> = {
  all: ['title', 'summary', 'category', 'goal_amount', 'start_at', 'end_at', 'cover_image'],
  contentOnly: ['summary', 'end_at', 'cover_image'],
}

export default function EditCampaignPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const t = useTranslations('funding')
  const router = useRouter()

  const [data, setData] = useState<EditorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<TabKey>('basic')

  const [basic, setBasic] = useState<BasicInfoValues | null>(null)
  const [basicOriginal, setBasicOriginal] = useState<BasicInfoValues | null>(null)
  const [story, setStory] = useState('')
  const [storyOriginal, setStoryOriginal] = useState('')
  const [rewards, setRewards] = useState<RewardRow[]>([])

  const errorRef = useRef<HTMLDivElement | null>(null)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    basic: null,
    story: null,
    rewards: null,
  })

  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  useEffect(() => {
    if (notice) {
      noticeRef.current?.focus()
    }
  }, [notice])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/mypage/funding/campaigns/${id}`)
      const body = await res.json().catch(() => null)
      if (res.ok === false || !body?.data?.campaign) {
        setError(t('creator.errorLoad'))
        return
      }
      const editorData = body.data as EditorData
      setData(editorData)
      const nextBasic = campaignToBasicValues(editorData.campaign)
      setBasic(nextBasic)
      setBasicOriginal(nextBasic)
      setStory(editorData.campaign.story ?? '')
      setStoryOriginal(editorData.campaign.story ?? '')
      setRewards(editorData.rewards ?? [])
    } catch {
      setError(t('creator.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void load()
  }, [load])

  // 저장하지 않은 변경이 있는가 — 스토리·리워드 탭은 지금은 스텁이라 값이
  // 절대 바뀌지 않지만, 비교 대상에 미리 넣어 둔다(Task 5·6이 실제 입력을
  // 붙이면 그대로 dirty 판정에 들어온다).
  const dirty = useMemo(() => {
    if (!basic || !basicOriginal) return false
    return JSON.stringify(basic) !== JSON.stringify(basicOriginal) || story !== storyOriginal
  }, [basic, basicOriginal, story, storyOriginal])

  // 저장하지 않은 변경이 있는 채로 탭(브라우저)을 닫거나 다른 주소로 가면
  // 경고한다. 앱 안 링크 이동(next/link)은 페이지를 새로 불러오지 않아
  // beforeunload가 뜨지 않는다 — 실제 브라우저 창 닫기·새로고침·주소 입력만
  // 잡는다.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + dir + TAB_ORDER.length) % TAB_ORDER.length
    const nextTab = TAB_ORDER[nextIndex]
    setTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }, [])

  const handleSave = useCallback(async () => {
    if (!data || !basic || !basicOriginal) return
    setError('')
    setNotice('')
    setSaving(true)
    try {
      const scope = data.edit_scope === 'all' ? 'all' : 'contentOnly'
      const fields = data.edit_scope === 'none' ? [] : BASIC_FIELDS_BY_SCOPE[scope]
      const patch: Record<string, unknown> = {}
      for (const key of fields) {
        if (basic[key] === basicOriginal[key]) continue
        if (key === 'goal_amount') {
          const n = parseGoalAmountDisplay(basic.goal_amount)
          if (n !== null) patch.goal_amount = n
          continue
        }
        if (key === 'start_at' || key === 'end_at') {
          patch[key] = basic[key] === '' ? null : basic[key]
          continue
        }
        patch[key] = basic[key]
      }
      // story는 contentOnly에서도 허용되는 필드다(CONTENT_ONLY_FIELDS) — 지금은
      // StoryTab이 스텁이라 절대 바뀌지 않지만, Task 5가 값을 채우면 이 자리가
      // 그대로 저장을 받는다.
      if (story !== storyOriginal) patch.story = story

      if (Object.keys(patch).length === 0) {
        setSaving(false)
        return
      }

      const res = await fetch(`/api/mypage/funding/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => null)
      if (res.ok === false || !body?.data?.campaign) {
        setError(body?.error || t('creator.errorSave'))
        return
      }
      const updated = body.data.campaign as CampaignFull
      const nextBasic = campaignToBasicValues(updated)
      setBasic(nextBasic)
      setBasicOriginal(nextBasic)
      setStory(updated.story ?? '')
      setStoryOriginal(updated.story ?? '')
      setData(prev => (prev ? { ...prev, campaign: { ...prev.campaign, ...updated } } : prev))
      setNotice(t('creator.saveSuccess'))
    } catch {
      setError(t('creator.errorSave'))
    } finally {
      setSaving(false)
    }
  }, [data, basic, basicOriginal, story, storyOriginal, id, t])

  const handleSubmitForReview = useCallback(async () => {
    // 제출이 성공하면 상태가 submitted가 되어 편집기 전체가 잠긴다 — 그
    // 순간부터는 저장하지 않은 입력을 되돌릴 방법이 없으므로, 저장하지 않은
    // 변경이 있으면 여기서 반드시 막는다.
    if (dirty) {
      setError(t('creator.blockedSubmitDirty'))
      return
    }
    if (!window.confirm(t('creator.confirmSubmit'))) return
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/mypage/funding/campaigns/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit' }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok === false) {
        setError(body?.error || t('creator.errorTransition'))
        return
      }
      router.push(`/mypage/funding/${id}`)
    } catch {
      setError(t('creator.errorTransition'))
    } finally {
      setSubmitting(false)
    }
  }, [dirty, id, t, router])

  const campaign = data?.campaign
  const editScope = data?.edit_scope ?? 'none'
  const readOnly = editScope === 'none'

  return (
    <PermissionCheck requiredPermission="member">
      <MypageLayout title={t('creator.editTitle')} description={t('creator.editDescription')}>
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
        ) : campaign && basic ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{campaign.title}</h1>
              <CampaignStatusBadge status={campaign.status} />
            </div>

            {readOnly ? (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-900">{t('creator.readOnlyGuidance')}</p>
                <Link
                  href={`/mypage/funding/${id}`}
                  className="mt-2 inline-block text-sm text-primary-600 hover:underline"
                >
                  {t('creator.backToDashboard')}
                </Link>
              </div>
            ) : null}

            <div
              role="tablist"
              aria-label={t('creator.editTitle')}
              className="mt-6 flex gap-2 border-b border-gray-200"
            >
              {TAB_ORDER.map((key, index) => {
                const label =
                  key === 'basic'
                    ? t('creator.tabBasic')
                    : key === 'story'
                      ? t('detail.storyHeading')
                      : t('detail.rewardsHeading')
                const selected = tab === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    ref={el => {
                      tabRefs.current[key] = el
                    }}
                    onClick={() => setTab(key)}
                    onKeyDown={e => handleTabKeyDown(e, index)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                      selected
                        ? 'border-primary-600 text-primary-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* 탭 전환 — 언마운트하지 않는다. 조건부 렌더로 바꾸면 탭을 옮길 때
                저장하지 않은 입력이 사라진다. */}
            <div role="tabpanel" className={tab === 'basic' ? 'mt-6 block' : 'hidden'}>
              <BasicInfoTab
                values={basic}
                onChange={setBasic}
                editScope={readOnly ? 'none' : editScope}
              />
            </div>
            <div role="tabpanel" className={tab === 'story' ? 'mt-6 block' : 'hidden'}>
              <StoryTab
                story={story}
                onChange={setStory}
                editScope={readOnly ? 'none' : editScope}
              />
            </div>
            <div role="tabpanel" className={tab === 'rewards' ? 'mt-6 block' : 'hidden'}>
              <RewardsTab
                campaignId={id}
                rewards={rewards}
                onChange={setRewards}
                editScope={readOnly ? 'none' : editScope}
              />
            </div>

            {readOnly ? null : (
              <div className="mt-8 flex flex-wrap gap-3 border-t border-gray-200 pt-6">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !dirty}
                  className="tw-btn-primary disabled:opacity-50"
                >
                  {saving ? t('creator.saving') : t('creator.save')}
                </button>
                {campaign.status === 'draft' ? (
                  <button
                    type="button"
                    onClick={() => void handleSubmitForReview()}
                    disabled={submitting}
                    className="tw-btn-secondary disabled:opacity-50"
                  >
                    {t('creator.submit')}
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </MypageLayout>
    </PermissionCheck>
  )
}
