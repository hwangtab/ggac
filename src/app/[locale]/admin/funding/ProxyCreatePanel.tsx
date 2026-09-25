'use client'

/**
 * 관리자 대리 개설. 개설자를 고르고 기본 정보만 넣어 초안을 만든다 — 본문·리워드·
 * 표지·제출은 만든 뒤 편집 화면(`/mypage/funding/[id]/edit`)에서 관리자가 이어서 한다.
 *
 * 요율은 승인할 때 개설자의 가입 승인 상태로 정해진다. 고르는 순간 어느 쪽이
 * 붙을지 보여 준다 — 비조합원을 고르고 나서 정산 때 알게 두지 않는다.
 */
import { useState } from 'react'
import { FiPlus, FiSearch, FiX } from 'react-icons/fi'

import { FEE_RATE_VAT_NOTE, formatFeeRatePercent, isFeeMember } from '@/lib/funding/feeRate'

const CATEGORIES = ['공연', '음반', '전시', '출판', '영상', '기타'] as const

interface MemberOption {
  id: string
  display_name: string
  email: string
  registration_status: string
  is_active: boolean
}

interface Props {
  memberRateBp: number
  nonmemberRateBp: number
  onCreated: (campaign: { id: string; title: string }) => void
}

export default function ProxyCreatePanel({ memberRateBp, nonmemberRateBp, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberOption[]>([])
  const [searching, setSearching] = useState(false)
  const [owner, setOwner] = useState<MemberOption | null>(null)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [goal, setGoal] = useState('')
  const [category, setCategory] = useState<string>('기타')
  const [attested, setAttested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/members?search=${encodeURIComponent(q)}&limit=10`)
      const json = await res.json()
      if (res.ok === false)
        throw new Error(json?.error?.message ?? json?.error ?? '회원을 찾지 못했습니다.')
      const members = (json?.data?.members ?? []) as MemberOption[]
      setResults(members.filter(m => m.registration_status !== 'withdrawn'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  function reset() {
    setQuery('')
    setResults([])
    setOwner(null)
    setTitle('')
    setSummary('')
    setGoal('')
    setCategory('기타')
    setAttested(false)
    setError(null)
  }

  async function submit() {
    setError(null)
    if (!owner) return setError('개설자를 골라 주세요.')
    const goalAmount = Number(goal.replace(/[^0-9]/g, ''))
    if (!title.trim() || !summary.trim() || !goalAmount) {
      return setError('제목·한 줄 소개·목표 금액을 모두 넣어 주세요.')
    }
    if (!attested) return setError('개설자 약관 안내·동의 확인에 체크해 주세요.')
    setBusy(true)
    try {
      const res = await fetch('/api/admin/funding/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerUserId: owner.id,
          title: title.trim(),
          summary: summary.trim(),
          goal_amount: goalAmount,
          category,
          agreedCreatorTermsOnBehalf: true,
        }),
      })
      const json = await res.json()
      if (res.ok === false)
        throw new Error(json?.error?.message ?? json?.error ?? '만들지 못했습니다.')
      const campaign = json.data.campaign as { id: string; title: string }
      reset()
      setOpen(false)
      onCreated(campaign)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
      >
        <FiPlus className="w-4 h-4" />
        대리 개설
      </button>
    )
  }

  const ownerIsMember = owner ? isFeeMember(owner) : false

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">대리 개설</h3>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          aria-label="닫기"
          className="p-1 text-gray-400 hover:text-gray-700"
        >
          <FiX className="w-5 h-5" />
        </button>
      </div>
      <p className="text-sm text-gray-600">
        개설자 대신 초안을 만듭니다. 만든 뒤 편집 화면에서 본문·리워드·표지를 채우고 심사에 제출할
        수 있습니다. 수수료율은 승인할 때 개설자가 조합원이면 {formatFeeRatePercent(memberRateBp)}%,
        아니면 {formatFeeRatePercent(nonmemberRateBp)}%(
        {FEE_RATE_VAT_NOTE})로 고정됩니다.
      </p>

      {error && (
        <div
          className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="proxy-owner-search"
          className="block text-sm font-medium text-gray-900 mb-1"
        >
          개설자
        </label>
        {owner ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-300 bg-primary-50 px-3 py-2">
            <span className="text-sm text-gray-900">
              {owner.display_name} <span className="text-gray-500">({owner.email})</span>
              <span className="ml-2 text-xs text-gray-600">
                {ownerIsMember ? '조합원' : '비조합원'} · 승인 시{' '}
                {formatFeeRatePercent(ownerIsMember ? memberRateBp : nonmemberRateBp)}%
              </span>
            </span>
            <button
              type="button"
              onClick={() => setOwner(null)}
              className="text-xs text-gray-600 hover:underline"
            >
              바꾸기
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                id="proxy-owner-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void search()
                  }
                }}
                placeholder="이름 또는 이메일"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void search()}
                disabled={searching}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <FiSearch className="w-4 h-4" />
                찾기
              </button>
            </div>
            {results.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {results.map(m => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setOwner(m)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {m.display_name} <span className="text-gray-500">({m.email})</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {isFeeMember(m) ? '조합원' : '비조합원'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="proxy-title" className="block text-sm font-medium text-gray-900 mb-1">
            제목
          </label>
          <input
            id="proxy-title"
            value={title}
            onChange={e => setTitle(e.target.value.slice(0, 80))}
            maxLength={80}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="proxy-summary" className="block text-sm font-medium text-gray-900 mb-1">
            한 줄 소개
          </label>
          <input
            id="proxy-summary"
            value={summary}
            onChange={e => setSummary(e.target.value.slice(0, 200))}
            maxLength={200}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="proxy-goal" className="block text-sm font-medium text-gray-900 mb-1">
            목표 금액(원)
          </label>
          <input
            id="proxy-goal"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="proxy-category" className="block text-sm font-medium text-gray-900 mb-1">
            분류
          </label>
          <select
            id="proxy-category"
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={attested}
          onChange={e => setAttested(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          개설자에게{' '}
          <a
            href="/funding/terms"
            target="_blank"
            rel="noreferrer"
            className="text-primary-700 underline"
          >
            펀딩 이용약관
          </a>
          (개설자 조항)을 안내하고 동의를 받았습니다. 이 확인은 제 관리자 계정으로 기록됩니다.
        </span>
      </label>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
      >
        {busy ? '만드는 중…' : '초안 만들기'}
      </button>
    </section>
  )
}
