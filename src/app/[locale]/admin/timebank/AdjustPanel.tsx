'use client'

import { useState } from 'react'
import { TIMEBANK_MEMO_MAX } from '@/constants/timebank'
import { timebankFetch } from '@/components/timebank/timebankFormat'
import { fmtMinutes, type AccountsResponse } from '@/components/timebank/timebankAdminFormat'

/** `RESOLUTION_REF_MIN`·`MAX`(`src/lib/timebank/adminRules.ts`)와 같다. */
const RESOLUTION_REF_MAX = 200

/**
 * 관리자 조정(스펙 §3.1·§7.3). 회원 ↔ 조합만 — 회원 사이로 옮기는 칸은 없다. 대상 ≠
 * 본인, 사유 필수, 30분 배수. 차감은 하한을 넘지 못한다(서버가 본다).
 *
 * 이중 승인 조건을 미리 설명하고, 서버가 pending으로 만들었으면(`needs_approval`) 그
 * 사실을 그대로 알린다. 승인은 "잔액·대기" 탭에서 다른 관리자가 한다.
 */
export default function AdjustPanel({
  accounts,
  dualApprovalMinutes,
  myId,
  onChanged,
}: {
  accounts: AccountsResponse['accounts']
  dualApprovalMinutes: number | null
  myId: string | null
  onChanged: () => void
}) {
  const [memberId, setMemberId] = useState('')
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit')
  const [minutes, setMinutes] = useState(60)
  const [memo, setMemo] = useState('')
  const [dispute, setDispute] = useState(false)
  const [resolutionRef, setResolutionRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const result = await timebankFetch<{ needs_approval: boolean }>(
      '/api/admin/timebank/adjust',
      {
        method: 'POST',
        json: {
          member_id: memberId.trim(),
          direction,
          minutes,
          memo,
          ...(dispute ? { dispute: true, resolution_ref: resolutionRef } : {}),
        },
      },
      '조정을 기록하지 못했습니다.'
    )
    setBusy(false)
    if (result.ok) {
      setNotice({
        kind: result.data.needs_approval ? 'warn' : 'ok',
        text: result.message ?? (result.data.needs_approval ? '승인 대기' : '확정'),
      })
      setMemo('')
      setResolutionRef('')
      onChanged()
    } else setNotice({ kind: 'error', text: result.error })
  }

  const field = 'mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm'
  const validMinutes = Number.isInteger(minutes) && minutes >= 30 && minutes % 30 === 0

  return (
    <section aria-labelledby="adm-adjust" data-testid="admin-timebank-adjust">
      <h2 id="adm-adjust" className="mb-2 text-lg font-semibold text-gray-900">
        조정
      </h2>
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        <p>조정은 조합원과 조합 계좌 사이에서만 합니다. 회원 사이로 크레딧을 옮기지 않습니다.</p>
        <p className="mt-2 font-medium">
          다음 경우에는 바로 확정되지 않고 다른 관리자의 승인을 기다립니다:
        </p>
        <ul className="mt-1 list-disc pl-5">
          <li>
            그달(KST) 그 대상의 조정 누적이 {fmtMinutes(dualApprovalMinutes)}을 넘게 되는 건 (쪼개기
            방지)
          </li>
          <li>분쟁 정리 — 크기와 무관하게, 이사회 결정 일자·안건이 필요합니다</li>
          <li>대상이 관리자 계정인 건 — 크기와 무관하게</li>
        </ul>
        <p className="mt-2">조정을 만든 관리자와 대상은 승인할 수 없습니다.</p>
      </div>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mb-3 rounded-lg p-3 text-sm ${
            notice.kind === 'error'
              ? 'bg-red-50 text-red-700'
              : notice.kind === 'warn'
                ? 'bg-amber-50 text-amber-800'
                : 'bg-green-50 text-green-800'
          }`}
        >
          {notice.text}
        </p>
      )}

      <form onSubmit={e => void submit(e)} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">
          대상 조합원
          <select className={field} value={memberId} onChange={e => setMemberId(e.target.value)}>
            <option value="">원장에 계좌가 있는 조합원에서 고르기</option>
            {accounts
              .filter(a => a.member_id !== myId)
              .map(a => (
                <option key={a.member_id} value={a.member_id}>
                  {a.display_name || a.member_id.slice(0, 8)} (잔액 {fmtMinutes(a.balance_minutes)})
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-medium text-gray-700">
          또는 회원 ID
          <input
            className={field}
            value={memberId}
            onChange={e => setMemberId(e.target.value)}
            placeholder="회원 ID"
          />
        </label>
        <fieldset className="text-sm">
          <legend className="font-medium text-gray-700">방향</legend>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="adjust-direction"
                checked={direction === 'credit'}
                onChange={() => setDirection('credit')}
              />
              적립(조합 → 조합원)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="adjust-direction"
                checked={direction === 'debit'}
                onChange={() => setDirection('debit')}
              />
              차감(조합원 → 조합)
            </label>
          </div>
        </fieldset>
        <label className="text-sm font-medium text-gray-700">
          시간(분, 30분 단위)
          <input
            type="number"
            min={30}
            step={30}
            className={field}
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
          />
          <span className="text-xs text-gray-500">{validMinutes ? fmtMinutes(minutes) : ''}</span>
        </label>
        <label className="text-sm font-medium text-gray-700 md:col-span-2">
          사유(필수, 원장에 남습니다)
          <input
            className={field}
            value={memo}
            onChange={e => setMemo(e.target.value)}
            maxLength={TIMEBANK_MEMO_MAX}
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-800 md:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={dispute}
            onChange={e => setDispute(e.target.checked)}
          />
          <span>분쟁 정리(이용규칙 제12조) — 이사회 결정에 따른 조정입니다</span>
        </label>
        {dispute && (
          <label className="text-sm font-medium text-gray-700 md:col-span-2">
            이사회 결정 근거(일자·안건, 필수)
            <input
              className={field}
              value={resolutionRef}
              onChange={e => setResolutionRef(e.target.value)}
              maxLength={RESOLUTION_REF_MAX}
              placeholder="예: 2026-11-20 제3차 이사회 안건 2"
            />
          </label>
        )}
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={
              busy ||
              !memberId.trim() ||
              !memo.trim() ||
              !validMinutes ||
              (dispute && !resolutionRef.trim())
            }
            className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? '기록하는 중…' : '조정 기록'}
          </button>
        </div>
      </form>
    </section>
  )
}
