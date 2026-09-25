'use client'

/**
 * 정산 내역 패널 — 관리자 화면이라 한국어 전용이고 next-intl을 쓰지 않는다.
 *
 * 화면이 지켜야 하는 것 하나: **어느 숫자가 사람 손에서 나왔는지 분명히
 * 말한다.** 총 모금액·환불액·후원자 수는 후원 원장에서 나오고, 결제대행
 * 수수료만 사람이 정산서를 보고 넣는다. 그래서 입력 칸은 하나뿐이고 그 칸
 * 옆에 그렇다고 적혀 있다.
 *
 * 금액은 화면이 계산하지 않는다 — 저장하면 서버가 그 순간의 원장으로 다시
 * 세어 돌려주고, 화면은 받은 값을 보인다. 미리보기조차 하지 않는 이유는
 * 미리보기가 맞는 것처럼 보이는 순간 그것이 근거가 되기 때문이다.
 */

import { useCallback, useEffect, useState } from 'react'

import {
  isPayoutAccountHolderMissing,
  isPayoutAccountRegistered,
  type PayoutAccount,
} from '@/lib/funding/payoutAccount'
import { cooperativeLossFor } from '@/lib/funding/settlement'
import { apiErrorMessage } from '@/utils/apiErrorMessage'
import { FEE_RATE_VAT_NOTE, formatFeeRatePercent } from '@/lib/funding/feeRate'

interface Settlement {
  status: 'pending' | 'paid'
  gross_amount: number
  refund_amount: number
  pg_fee_amount: number
  platform_fee_amount: number
  payout_amount: number
  backer_count: number
  paid_out_at: string | null
  memo: string | null
}

interface Payload {
  settlement: Settlement | null
  current_basis: {
    gross_amount: number
    refund_amount: number
    backer_count: number
    net_amount: number
  }
  /**
   * 이 캠페인에 **승인 시점에 새겨진** 요율. 지금 설정값이 아니다 — 승인 뒤에
   * 사무국이 설정을 바꿔도 이 값은 움직이지 않는다. 조합원 3.3% / 비조합원
   * 5.5%이며 둘 다 부가세를 포함한 전액 요율이다.
   */
  platform_fee_rate_bp: number
  is_stale: boolean
  /** 개설자 프로필에 은행·계좌번호가 둘 다 있는가. 정리·지급 응답에도 실린다. */
  payout_account_registered: boolean
  /**
   * 정리·지급 때 토스 대조를 건너뛰었다면 그 사유 한 줄, 아니면 `null`.
   * 조회(GET) 응답에는 없다 — 대조는 쓰는 자리에서만 돈다.
   */
  reconcile_skipped?: string | null
}

/** 조회 응답에만 실리는 계좌. 정리·지급 응답에는 없다(서버 주석 참고). */
interface PayloadWithAccount extends Payload {
  payout_account: PayoutAccount | null
}

function won(n: number): string {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`
}

export default function SettlementPanel({
  campaignId,
  campaignTitle,
  onSettled,
}: {
  campaignId: string
  campaignTitle: string
  /** 정산서가 움직였을 때 바깥 목록을 새로고침한다. */
  onSettled?: () => void
}) {
  const [payload, setPayload] = useState<Payload | null>(null)
  /**
   * 계좌는 **눌러야 온다.** 이 패널은 마감된 캠페인마다 하나씩 그려지므로,
   * 처음부터 실어 오면 목록을 한 번 여는 것만으로 남의 계좌번호가 화면 가득
   * 깔린다. 이체하려는 그 한 건에서만 받아 여기 담는다.
   */
  const [account, setAccount] = useState<PayoutAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pgFee, setPgFee] = useState('')
  const [memo, setMemo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/funding/campaigns/${campaignId}/settlement`)
      const json = await res.json()
      if (res.ok === false)
        throw new Error(apiErrorMessage(json, '정산 내역을 불러오지 못했습니다.'))
      const data = json.data as Payload
      setPayload(data)
      if (data.settlement) {
        setPgFee(String(data.settlement.pg_fee_amount))
        setMemo(data.settlement.memo ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 계좌를 한 번 받아 온다. 서버가 **이 요청을 활동 기록에 남긴다** —
   * 누가 언제 어느 캠페인의 계좌를 열어 봤는지가 그 한 줄이다.
   */
  const revealAccount = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/funding/campaigns/${campaignId}/settlement?account=1`)
      const json = await res.json()
      if (res.ok === false) {
        setError(apiErrorMessage(json, '입금 계좌를 불러오지 못했습니다.'))
        return
      }
      const data = json.data as PayloadWithAccount
      setPayload(data)
      setAccount(data.payout_account ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [campaignId])

  async function send(init: RequestInit, successMessage: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/funding/campaigns/${campaignId}/settlement`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      const json = await res.json()
      if (res.ok === false) {
        // 409는 "그 사이에 무언가 움직였다"는 뜻이다. 서버가 무엇이 움직였는지
        // 문장으로 말해 주므로 그대로 보이고, 현재 값을 다시 불러온다.
        setError(apiErrorMessage(json, '처리하지 못했습니다.'))
        if (res.status === 409) await load()
        return
      }
      setPayload(json.data as Payload)
      setNotice(successMessage)
      onSettled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function handlePrepare() {
    const value = Number(pgFee.replace(/,/g, '').trim())
    if (!Number.isSafeInteger(value) || value < 0) {
      setError('결제대행 수수료를 0원 이상의 정수로 입력해 주세요.')
      return
    }
    void send(
      { method: 'POST', body: JSON.stringify({ pg_fee_amount: value, memo: memo.trim() || null }) },
      '정산 내역을 정리했습니다.'
    )
  }

  function handleMarkPaid() {
    const payout = payload?.settlement?.payout_amount ?? 0
    // 계좌가 없는 건은 **무엇을 기록하는 것인지** 한 번 더 읽게 한다. 막지는
    // 않는다 — 이 버튼을 누를 때 이체는 이미 끝난 일이고, 기록을 거절해도
    // 나간 돈은 돌아오지 않는다. 대신 등록된 계좌가 없었다는 사실이 활동
    // 기록에 함께 남는다(서버가 남긴다).
    const noAccount = payload?.payout_account_registered === false
    const ok = window.confirm(
      noAccount
        ? `"${campaignTitle}"의 정산금 ${won(payout)}을 지급한 것으로 기록합니다.\n개설자가 등록해 둔 계좌가 없습니다. 사무국이 따로 확인한 계좌로 실제 이체를 끝냈을 때만 누르세요.\n등록된 계좌가 없었다는 사실이 활동 기록에 함께 남고, 기록한 뒤에는 금액을 고칠 수 없습니다. 계속할까요?`
        : `"${campaignTitle}"의 정산금 ${won(payout)}을 지급한 것으로 기록합니다.\n기록한 뒤에는 금액을 고칠 수 없습니다. 실제로 이체를 끝냈을 때만 누르세요. 계속할까요?`
    )
    if (!ok) return
    void send(
      {
        method: 'PATCH',
        // 계좌가 없다는 것을 읽고 눌렀다는 표시. 화면이 계좌가 있다고 믿은
        // 채로 보내면 서버가 409로 돌려보내고 화면이 다시 읽는다.
        body: JSON.stringify({ action: 'mark_paid', acknowledge_no_account: noAccount }),
      },
      '지급을 기록했습니다.'
    )
  }

  if (loading) return <p className="text-sm text-gray-500">정산 내역을 불러오는 중…</p>

  const settlement = payload?.settlement ?? null
  const paid = settlement?.status === 'paid'
  const basis = payload?.current_basis
  const rate = payload?.platform_fee_rate_bp ?? 0
  // 수수료가 실 모금액보다 클 때의 차액 — 후원이 전부 환불된 캠페인에서
  // 생긴다. 숨기면 0원 지급이 "수수료를 안 냈다"처럼 읽힌다.
  const loss = settlement ? cooperativeLossFor(settlement) : 0
  // 등록 여부는 서버가 판정해 보내지만, 계좌를 아직 못 받은 첫 렌더에서도
  // 화면이 일관되게 굴도록 받은 값으로 한 번 더 확인한다.
  const accountRegistered = payload?.payout_account_registered === true
  const accountHolderMissing = isPayoutAccountHolderMissing(account)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-900">정산 내역</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            paid ? 'bg-purple-100 text-purple-800' : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {settlement ? (paid ? '지급 완료' : '지급 전') : '정리 전'}
        </span>
      </div>

      {/* 서버가 답한 결과는 소리 내어 읽히게 한다 — 성공도 실패도. */}
      <p className="sr-only" aria-live="polite">
        {error ?? notice ?? ''}
      </p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-green-700">{notice}</p> : null}

      {payload?.reconcile_skipped ? (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {payload.reconcile_skipped}
        </p>
      ) : null}

      {payload?.is_stale ? (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          정리한 뒤 후원 환불이 있었습니다. 지금 원장 기준으로는 총 모금액{' '}
          {won(basis?.gross_amount ?? 0)}, 환불 {won(basis?.refund_amount ?? 0)}입니다. 다시
          정리해야 지급을 기록할 수 있습니다.
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-500">총 모금액</dt>
          <dd className="font-semibold text-gray-900">
            {won(settlement?.gross_amount ?? basis?.gross_amount ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">환불액</dt>
          <dd className="font-semibold text-gray-900">
            {won(settlement?.refund_amount ?? basis?.refund_amount ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">실 모금액</dt>
          <dd className="font-semibold text-gray-900">
            {won(
              settlement
                ? settlement.gross_amount - settlement.refund_amount
                : (basis?.net_amount ?? 0)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">후원자 수</dt>
          <dd className="font-semibold text-gray-900">
            {settlement?.backer_count ?? basis?.backer_count ?? 0}명
          </dd>
        </div>
        {settlement ? (
          <>
            <div>
              <dt className="text-xs text-gray-500">결제대행 수수료</dt>
              <dd className="font-semibold text-gray-900">{won(settlement.pg_fee_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">
                플랫폼 수수료({formatFeeRatePercent(rate)}% · {FEE_RATE_VAT_NOTE})
              </dt>
              <dd className="font-semibold text-gray-900">{won(settlement.platform_fee_amount)}</dd>
            </div>
            {loss > 0 ? (
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">조합이 부담한 차액</dt>
                <dd className="font-semibold text-gray-900">{won(loss)}</dd>
              </div>
            ) : null}
            <div className="col-span-2">
              <dt className="text-xs text-gray-500">지급액</dt>
              <dd className="text-lg font-bold text-gray-900">{won(settlement.payout_amount)}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {/* 요율이 어디서 왔는지 한 줄로 말한다 — 지금 설정이 아니라 승인할 때
          새긴 값이다. 그리고 부가세가 이미 들어 있다. */}
      {settlement ? (
        <p className="mt-2 text-xs text-gray-500">
          플랫폼 수수료율 {formatFeeRatePercent(rate)}%는 이 캠페인을 승인할 때 새긴 값입니다(
          {FEE_RATE_VAT_NOTE}이라 여기에 부가세를 따로 더하지 않습니다). 지금 설정을 바꿔도 이
          캠페인에는 적용되지 않습니다.
        </p>
      ) : null}

      {/*
        어디로 보내는가. 이체는 사람이 손으로 하므로 은행·계좌번호·예금주
        셋이 한자리에 있어야 하고, 그 셋이 전부다 — 더 싣지 않는다.
        사무국 전용이며, 그 판정은 이 화면이 아니라 라우트(`requireAdmin`)가
        한다. 열어 본 사실은 서버가 활동 기록에 남긴다.
      */}
      <section className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="text-xs font-semibold text-gray-700">
          입금 계좌 — 개설자 프로필 기준, 사무국만 보입니다
        </h5>
        {accountRegistered && isPayoutAccountRegistered(account) === false ? (
          <div className="mt-2">
            <p className="text-sm text-gray-600">
              계좌가 등록돼 있습니다. 이체할 때 눌러서 확인하세요 — 누가 언제 열어 봤는지 기록에
              남습니다.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void revealAccount()}
              className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              입금 계좌 보기
            </button>
          </div>
        ) : accountRegistered ? (
          <>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-gray-500">은행</dt>
                <dd className="font-semibold text-gray-900">{account?.bank_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">계좌번호</dt>
                <dd className="font-semibold text-gray-900">{account?.account_number}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">예금주</dt>
                <dd className="font-semibold text-gray-900">
                  {account?.account_holder ?? '비어 있음'}
                </dd>
              </div>
            </dl>
            {accountHolderMissing ? (
              <p className="mt-2 text-xs text-gray-600">
                예금주가 비어 있습니다. 이체 화면에서 표시되는 이름으로 확인해 주세요.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-amber-900">
            개설자가 등록해 둔 계좌가 없습니다. 정산 내역을 정리하면 개설자에게 계좌를 등록해 달라는
            알림이 함께 갑니다. 사무국이 따로 확인한 계좌로 이미 보냈다면 그대로 지급을 기록할 수
            있고, 등록된 계좌가 없었다는 사실이 활동 기록에 남습니다.
          </p>
        )}
      </section>

      {loss > 0 ? (
        <p className="mt-3 text-sm text-gray-600">
          실 모금액보다 수수료가 {won(loss)} 많습니다. 후원이 전부 환불돼 남은 돈이 없는 경우이며,
          결제대행사는 환불해도 수수료를 대체로 돌려주지 않습니다. 이 차액은 조합이 부담하고
          창작자에게 청구하지 않습니다.
        </p>
      ) : null}

      {paid ? (
        <p className="mt-3 text-sm text-gray-600">
          {settlement?.paid_out_at
            ? `${new Date(settlement.paid_out_at).toLocaleString('ko-KR')}에 지급으로 기록했습니다.`
            : '지급으로 기록했습니다.'}{' '}
          지급한 정산 내역은 고칠 수 없습니다. 이제 '정산 완료 처리'를 누를 수 있습니다.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`pg-fee-${campaignId}`} className="text-xs font-medium text-gray-600">
              결제대행 수수료(원) — 이 값만 사람이 넣습니다
            </label>
            <input
              id={`pg-fee-${campaignId}`}
              type="text"
              inputMode="numeric"
              value={pgFee}
              disabled={busy}
              onChange={e => setPgFee(e.target.value)}
              placeholder="예: 33000"
              aria-describedby={`pg-fee-help-${campaignId}`}
              className="w-48 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p id={`pg-fee-help-${campaignId}`} className="text-xs text-gray-500">
              토스는 수수료를 알려 주지 않고 우리도 저장하지 않습니다. 결제사 정산서에 적힌 금액을
              그대로 넣어 주세요. 나머지 금액은 후원 내역에서 자동으로 계산됩니다.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`memo-${campaignId}`} className="text-xs font-medium text-gray-600">
              메모 — 사무국 기록용이며 개설자에게 보이지 않습니다
            </label>
            <input
              id={`memo-${campaignId}`}
              type="text"
              value={memo}
              disabled={busy}
              onChange={e => setMemo(e.target.value)}
              placeholder="예: 9월 토스 정산서 기준"
              className="w-full max-w-md rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handlePrepare}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {settlement ? '다시 정리' : '정산 내역 정리'}
            </button>
            {settlement ? (
              <button
                type="button"
                disabled={busy || payload?.is_stale === true}
                onClick={handleMarkPaid}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                지급 기록
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
