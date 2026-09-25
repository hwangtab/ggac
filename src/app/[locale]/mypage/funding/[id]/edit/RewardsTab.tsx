'use client'

/**
 * 리워드 탭 — 목록·추가·삭제·순서 바꾸기와 저장.
 *
 * 다른 두 탭과 달리 이 탭은 **자기 값을 직접 저장한다**
 * (`PUT /api/mypage/funding/campaigns/[id]/rewards`). 껍데기의 "저장"
 * 버튼은 기본 정보·이야기만 PATCH하고 리워드는 손대지 않으므로, 여기 있는
 * "리워드 저장" 버튼이 유일한 저장 경로다. 그 분담을 화면에도 적는다
 * (`rewardsSaveScopeNotice`) — 적지 않으면 아래쪽 "저장"을 눌러 놓고
 * 저장됐다고 믿게 된다. `onChange`는 부모(껍데기)가
 * 들고 있는 `rewards` 배열을 갱신하는 통로일 뿐이고(다른 탭과 같은 제어
 * 컴포넌트 계약), 서버에 실제로 쓰는 것은 이 컴포넌트가 `campaignId`로
 * 직접 한다.
 *
 * `onChange`와 `onSaved`를 나눈 이유 — 껍데기는 "마지막으로 불러오거나
 * 저장한 값"(`rewardsOriginal`)과 "지금 편집 중인 값"(`rewards`)을 따로
 * 들고 저장 안 한 변경을 판단한다(제출 차단·창 닫기 경고가 이걸로 움직인다).
 * 이 탭에서 한 글자만 고쳐도 `onChange`가 불려 `rewards`가 바뀌므로 그
 * 차이가 곧바로 드러나고, PUT이 성공해 서버 값으로 화면을 맞출
 * 때(`onSaved`)만 두 값이 같아져 다시 "저장 안 한 변경 없음" 상태가 된다.
 * `onSaved`가 없으면 리워드만 고치고 저장하지 않은 채로 심사에 올리거나
 * 탭을 벗어나도 아무도 막지 않는다.
 *
 * **규칙의 정본은 서버다.** 여기서 하는 잠금·최소수량 판단은 전부
 * `rewardsTabHelpers.ts`의 순수 함수로 미리 알려 주는 것뿐이고, 서버가
 * 거절하면(`evaluateRewardPatch`·`canDeleteReward`) 그 문장을 그대로 보인다.
 * 저장 도중 다른 사람이 그 리워드에 후원을 확정하면 서버가 409를
 * 돌려준다 — 그 시점부터 화면의 값과 DB 값이 어긋날 수 있으므로(다른 행은
 * 이미 써졌는데 이 행만 거절됐을 수 있다), 문장을 보여 주는 것과 별개로
 * 캠페인을 다시 불러와 화면을 DB와 맞춘다(`reloadFromServer`).
 *
 * 탭이 `hidden`으로만 감춰지고 언마운트되지 않으므로(껍데기 참고), 리워드
 * 목록은 항상 `props.rewards`를 그대로 그리고 바뀔 때마다 `onChange`로
 * 올려보낸다 — 이 컴포넌트가 별도로 목록을 복제해 들고 있지 않는다. 다만
 * "저장된 원래 값"(잠금 최소수량의 기준)은 `props`가 바뀔 때마다 다시
 * 잡으면 안 된다 — 마운트 시점과 저장 성공(또는 409 재조회) 시점에만
 * 갱신한다(아래 `baselineRef`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FiAlertCircle, FiChevronDown, FiChevronUp, FiPlus, FiTrash2 } from 'react-icons/fi'

import {
  buildRewardsPayload,
  computeRewardLockState,
  clampQuantityToMin,
  formatAmountDisplay,
  isTempId,
  makeTempId,
  moveReward,
  parseAmountInput,
  parseQuantityInput,
  withSequentialSortOrder,
} from './rewardsTabHelpers'

/** GET /api/mypage/funding/campaigns/[id]가 주는 리워드 행. 서버 응답과 1:1. */
export interface RewardRow {
  id: string
  title: string
  description: string | null
  amount: number
  total_quantity: number | null
  requires_shipping: boolean
  requires_credit_name: boolean
  estimated_delivery: string | null
  image_url: string | null
  sort_order: number
  locked_at: string | null
}

export interface RewardsTabProps {
  campaignId: string
  rewards: RewardRow[]
  onChange: (rewards: RewardRow[]) => void
  /** 저장(PUT 성공) 또는 409 뒤 재조회로 서버와 화면이 다시 같아졌을 때만
   * 부른다 — 껍데기가 이걸로 "마지막으로 저장한 값"을 다시 잡아 저장하지
   * 않은 변경 판정을 지운다. */
  onSaved: (rewards: RewardRow[]) => void
  editScope: 'all' | 'contentOnly' | 'none'
}

function blankReward(sortOrder: number): RewardRow {
  return {
    id: makeTempId(),
    title: '',
    description: null,
    amount: 0,
    total_quantity: null,
    requires_shipping: false,
    requires_credit_name: false,
    estimated_delivery: null,
    image_url: null,
    sort_order: sortOrder,
    locked_at: null,
  }
}

export default function RewardsTab({
  campaignId,
  rewards,
  onChange,
  onSaved,
  editScope,
}: RewardsTabProps) {
  const t = useTranslations('funding')
  const readOnly = editScope === 'none'

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const errorRef = useRef<HTMLDivElement | null>(null)
  const noticeRef = useRef<HTMLDivElement | null>(null)

  // 각 리워드의 "저장된 원래 값" — 잠금 최소수량의 기준이다. 마운트 시점에
  // 한 번만 잡고, 저장이 성공했을 때만 서버가 돌려준 값으로 다시 잡는다.
  // props가 바뀔 때마다 다시 잡으면(예: 다른 탭 렌더로 인한 리렌더) 이 세션
  // 안에서 이미 늘려 둔 수량이 다음 순간 다시 최소값 노릇을 해서, 늘렸다가
  // 줄이는 정상적인 되돌리기까지 막아 버린다.
  const baselineRef = useRef<Map<string, RewardRow> | null>(null)
  if (baselineRef.current === null) {
    baselineRef.current = new Map(rewards.map(r => [r.id, r]))
  }

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

  const setRow = useCallback(
    (id: string, patch: Partial<RewardRow>) => {
      onChange(rewards.map(r => (r.id === id ? { ...r, ...patch } : r)))
    },
    [rewards, onChange]
  )

  const handleAdd = useCallback(() => {
    onChange(withSequentialSortOrder([...rewards, blankReward(rewards.length)]))
  }, [rewards, onChange])

  const handleRemove = useCallback(
    (id: string) => {
      onChange(withSequentialSortOrder(rewards.filter(r => r.id !== id)))
    },
    [rewards, onChange]
  )

  const handleMove = useCallback(
    (index: number, direction: -1 | 1) => {
      onChange(moveReward(rewards, index, direction))
    },
    [rewards, onChange]
  )

  // DB가 화면 밑에서 움직였을 수 있는 실패 뒤에만 부른다 — 409(다른 사람이
  // 방금 후원을 확정함)와 5xx(쓰는 도중에 멈춤)다. PUT은 행마다 순서대로
  // 쓰므로 그 둘은 앞쪽 행이 이미 저장된 채로 끝날 수 있고, 그 상태를 두면
  // 다음 저장 때 같은 리워드를 하나 더 만든다.
  //
  // 입력이 틀려서 받는 거절(400·404·503)은 여기 오지 않는다 — 라우트가 모든
  // 행을 검증한 **뒤에** 쓰기 때문에 DB는 그대로이고, 다시 불러오면 방금
  // 입력한 리워드가 통째로 사라진다(`onSaved`가 편집 중인 값과 기준값을 함께
  // 덮는다). 고칠 수 있게 입력을 남겨 둔다.
  const reloadFromServer = useCallback(async () => {
    try {
      const res = await fetch(`/api/mypage/funding/campaigns/${campaignId}`)
      const body = await res.json().catch(() => null)
      if (res.ok === false || !Array.isArray(body?.data?.rewards)) return
      const fresh = body.data.rewards as RewardRow[]
      baselineRef.current = new Map(fresh.map(r => [r.id, r]))
      onSaved(fresh)
    } catch {
      // 재조회 실패는 조용히 넘긴다 — 이미 보이는 거절 문장이 "새로고침해
      // 달라"고 안내하므로, 사용자가 직접 새로고침해도 같은 결과에 이른다.
    }
  }, [campaignId, onSaved])

  const handleSave = useCallback(async () => {
    setError('')
    setNotice('')

    // 제출 전 검사 — 타이핑 중 클램프(아래 수량 입력)가 이미 하한 아래 값을
    // 걸러내지만, 그것과 별개로 저장 직전에 한 번 더 확인한다(브리프가
    // "min 속성과 제출 전 검사 둘 다"를 요구한다).
    for (const r of rewards) {
      const baseline = baselineRef.current?.get(r.id) ?? null
      const lock = computeRewardLockState(
        r,
        isTempId(r.id),
        editScope,
        baseline?.total_quantity ?? null
      )
      if (
        lock.quantityMin !== null &&
        clampQuantityToMin(r.total_quantity, lock.quantityMin) !== r.total_quantity
      ) {
        setError(t('creator.rewardLocked'))
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/mypage/funding/campaigns/${campaignId}/rewards`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewards: buildRewardsPayload(rewards) }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok === false || !Array.isArray(body?.data?.rewards)) {
        setError(body?.error || t('creator.errorSave'))
        // 일부 행이 이미 써진 채로 끝났을 수 있는 실패만 다시 맞춘다. 입력이
        // 틀려서 받은 거절이면 DB는 그대로이므로 입력을 지우지 않는다.
        if (res.status === 409 || res.status >= 500) void reloadFromServer()
        return
      }
      const saved = body.data.rewards as RewardRow[]
      baselineRef.current = new Map(saved.map(r => [r.id, r]))
      onSaved(saved)
      setNotice(t('creator.rewardsSaved'))
    } catch {
      setError(t('creator.errorSave'))
    } finally {
      setSaving(false)
    }
  }, [rewards, campaignId, editScope, onSaved, reloadFromServer, t])

  return (
    <div className="space-y-5">
      {/* 리워드의 저장 경로는 이 탭 안에 있다 — 껍데기 아래쪽 "저장" 버튼은
          기본 정보와 이야기만 맡는다. 읽는 사람이 바로 그 자리에 적는다. */}
      {readOnly ? null : (
        <p className="text-sm text-gray-600">{t('creator.rewardsSaveScopeNotice')}</p>
      )}

      {editScope === 'contentOnly' ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {t('creator.rewardsActiveNotice')}
        </p>
      ) : null}

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

      {notice ? (
        <div
          ref={noticeRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 outline-none"
        >
          {notice}
        </div>
      ) : null}

      {rewards.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-8 text-center">
          <p className="text-sm text-gray-500">{t('creator.rewardsEmpty')}</p>
        </div>
      ) : null}

      <div className="space-y-4">
        {rewards.map((reward, index) => {
          const baseline = baselineRef.current?.get(reward.id) ?? null
          const isNew = isTempId(reward.id)
          const lock = computeRewardLockState(
            reward,
            isNew,
            editScope,
            baseline?.total_quantity ?? null
          )
          const titleId = `reward-${reward.id}-title`
          const descId = `reward-${reward.id}-description`
          const amountId = `reward-${reward.id}-amount`
          const quantityId = `reward-${reward.id}-quantity`
          const deliveryId = `reward-${reward.id}-delivery`

          return (
            <div key={reward.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMove(index, -1)}
                    disabled={readOnly || index === 0}
                    aria-label={t('creator.rewardMoveUp')}
                    className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <FiChevronUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(index, 1)}
                    disabled={readOnly || index === rewards.length - 1}
                    aria-label={t('creator.rewardMoveDown')}
                    className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <FiChevronDown className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {lock.deleteHidden ? null : (
                  <button
                    type="button"
                    onClick={() => handleRemove(reward.id)}
                    aria-label={t('creator.rewardRemove')}
                    className="rounded p-1 text-gray-400 transition-colors hover:text-red-500"
                  >
                    <FiTrash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>

              {lock.showLockedReason ? (
                <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden />
                  <span>{t('creator.rewardLocked')}</span>
                </p>
              ) : null}

              <div className="space-y-4">
                <div>
                  <label htmlFor={titleId} className="mb-2 block text-sm font-medium text-gray-900">
                    {t('creator.rewardTitle')}
                  </label>
                  <input
                    id={titleId}
                    value={reward.title}
                    onChange={e => setRow(reward.id, { title: e.target.value.slice(0, 60) })}
                    maxLength={60}
                    disabled={readOnly || lock.nameDescDisabled}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>

                <div>
                  <label htmlFor={descId} className="mb-2 block text-sm font-medium text-gray-900">
                    {t('creator.rewardDescription')}
                  </label>
                  <textarea
                    id={descId}
                    value={reward.description ?? ''}
                    onChange={e =>
                      setRow(reward.id, { description: e.target.value.slice(0, 1000) || null })
                    }
                    maxLength={1000}
                    rows={3}
                    disabled={readOnly || lock.nameDescDisabled}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={amountId}
                      className="mb-2 block text-sm font-medium text-gray-900"
                    >
                      {t('creator.rewardAmount')}
                    </label>
                    <input
                      id={amountId}
                      value={formatAmountDisplay(reward.amount)}
                      onChange={e =>
                        setRow(reward.id, { amount: parseAmountInput(e.target.value) })
                      }
                      inputMode="numeric"
                      disabled={readOnly || lock.amountShippingDisabled}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={quantityId}
                      className="mb-2 block text-sm font-medium text-gray-900"
                    >
                      {t('creator.rewardQuantity')}
                    </label>
                    <input
                      id={quantityId}
                      type="number"
                      min={lock.quantityMin ?? undefined}
                      value={reward.total_quantity ?? ''}
                      onChange={e => {
                        const parsed = parseQuantityInput(e.target.value)
                        setRow(reward.id, {
                          total_quantity: clampQuantityToMin(parsed, lock.quantityMin),
                        })
                      }}
                      disabled={readOnly}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('creator.rewardQuantityHelp')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm text-gray-900">
                      <input
                        type="checkbox"
                        checked={reward.requires_shipping}
                        onChange={e => setRow(reward.id, { requires_shipping: e.target.checked })}
                        disabled={readOnly || lock.amountShippingDisabled}
                        className="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed"
                      />
                      {t('creator.rewardShipping')}
                    </label>
                    <div>
                      <label className="flex items-center gap-2 text-sm text-gray-900">
                        <input
                          type="checkbox"
                          checked={reward.requires_credit_name}
                          onChange={e =>
                            setRow(reward.id, { requires_credit_name: e.target.checked })
                          }
                          disabled={readOnly || lock.amountShippingDisabled}
                          className="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed"
                        />
                        {t('creator.rewardCreditName')}
                      </label>
                      <p className="mt-1 text-xs text-gray-500">
                        {t('creator.rewardCreditNameHelp')}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor={deliveryId}
                      className="mb-2 block text-sm font-medium text-gray-900"
                    >
                      {t('creator.rewardDelivery')}
                    </label>
                    <input
                      id={deliveryId}
                      type="month"
                      value={reward.estimated_delivery ?? ''}
                      onChange={e =>
                        setRow(reward.id, { estimated_delivery: e.target.value || null })
                      }
                      disabled={readOnly}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('creator.rewardDeliveryHelp')}</p>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-5">
          <button
            type="button"
            onClick={handleAdd}
            className="flex items-center gap-1 rounded-md bg-primary-50 px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100"
          >
            <FiPlus className="h-4 w-4" aria-hidden />
            {t('creator.addReward')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="tw-btn-primary disabled:opacity-50"
          >
            {saving ? t('creator.savingRewards') : t('creator.saveRewards')}
          </button>
        </div>
      )}
    </div>
  )
}
