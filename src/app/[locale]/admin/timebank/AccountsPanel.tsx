'use client'

import { useState } from 'react'
import { timebankFetch } from '@/components/timebank/timebankFormat'
import {
  KIND_LABEL,
  adjustmentTarget,
  flowLabel,
  fmtKst,
  fmtMinutes,
  type AccountsResponse,
  type TransferRow,
} from '@/components/timebank/timebankAdminFormat'

/**
 * 잔액표·플래그·7일 넘은 대기·승인을 기다리는 조정(스펙 §7.3).
 *
 * - 조정 승인은 만든 관리자도 대상도 아닌 관리자만 한다 — 그런 경우 단추를 끈다
 *   (서버 `approveAdjustment`가 `self_approval`로 다시 막는다).
 * - 관리자 취소(분쟁 정리)는 어느 kind의 pending이든, 사유가 필수다.
 */
export default function AccountsPanel({
  data,
  myId,
  onChanged,
}: {
  data: AccountsResponse
  myId: string | null
  onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelMemo, setCancelMemo] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const names = new Map(data.accounts.map(a => [a.member_id, a.display_name]))
  // 관리자는 원장 계좌가 없을 수 있어 잔액표 이름에 없다 — 지금 관리자는 '나'로 쓴다.
  const nameOf = (id: string | null) =>
    id ? (id === myId ? '나' : names.get(id) || id.slice(0, 8)) : '—'

  const approve = async (row: TransferRow) => {
    setBusyId(row.id)
    setNotice(null)
    const result = await timebankFetch(
      `/api/admin/timebank/adjust/${row.id}/approve`,
      { method: 'POST' },
      '조정을 승인하지 못했습니다.'
    )
    setBusyId(null)
    if (result.ok) {
      setNotice({ kind: 'ok', text: result.message ?? '조정을 승인했습니다.' })
      onChanged()
    } else setNotice({ kind: 'error', text: result.error })
  }

  const cancel = async (row: TransferRow) => {
    setBusyId(row.id)
    setNotice(null)
    const result = await timebankFetch(
      `/api/admin/timebank/transfers/${row.id}/cancel`,
      { method: 'POST', json: { memo: cancelMemo } },
      '기록을 취소하지 못했습니다.'
    )
    setBusyId(null)
    if (result.ok) {
      setNotice({ kind: 'ok', text: result.message ?? '기록을 취소했습니다.' })
      setCancelId(null)
      setCancelMemo('')
      onChanged()
    } else setNotice({ kind: 'error', text: result.error })
  }

  const cancelControls = (row: TransferRow) =>
    cancelId === row.id ? (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={cancelMemo}
          onChange={e => setCancelMemo(e.target.value)}
          placeholder="취소 사유(필수, 당사자에게 알림으로 갑니다)"
          className="min-w-[16rem] flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          aria-label="취소 사유"
        />
        <button
          type="button"
          onClick={() => void cancel(row)}
          disabled={busyId === row.id || !cancelMemo.trim()}
          className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
        >
          취소 확정
        </button>
        <button
          type="button"
          onClick={() => setCancelId(null)}
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700"
        >
          닫기
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => {
          setCancelId(row.id)
          setCancelMemo('')
        }}
        className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
      >
        관리자 취소
      </button>
    )

  return (
    <div className="space-y-8">
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg p-3 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}
        >
          {notice.text}
        </p>
      )}

      <section
        aria-labelledby="adm-adjust-pending"
        data-testid="admin-timebank-pending-adjustments"
      >
        <h2 id="adm-adjust-pending" className="mb-2 text-lg font-semibold text-gray-900">
          승인을 기다리는 조정 ({data.pending_adjustments.length})
        </h2>
        <p className="mb-3 text-sm text-gray-600">
          이중 승인이 필요한 조정입니다 — 그달 그 대상의 조정 누적이 기준을 넘거나, 분쟁 정리(이사회
          결정 근거)이거나, 대상이 관리자 계정인 건. 만든 관리자와 대상은 승인할 수 없습니다.
        </p>
        {data.pending_adjustments.length === 0 ? (
          <p className="text-sm text-gray-500">없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {data.pending_adjustments.map(row => {
              const target = adjustmentTarget(row)
              const mine = myId !== null && (row.created_by === myId || target.memberId === myId)
              const reason =
                row.dual_approval_reason === 'dispute'
                  ? `분쟁 정리 — 이사회 결정 근거: ${row.ref_id ?? '—'}`
                  : row.dual_approval_reason === 'admin_target'
                    ? '대상이 관리자 계정'
                    : '그달 그 대상의 조정 누적이 이중 승인 기준을 넘음'
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                  data-testid="admin-timebank-pending-adjustment"
                >
                  <p className="text-sm text-gray-900">
                    <strong>{target.direction === 'credit' ? '적립' : '차감'}</strong>{' '}
                    {fmtMinutes(row.minutes)} · 대상 {target.memberName || nameOf(target.memberId)}{' '}
                    · 만든 관리자 {nameOf(row.created_by)} · {fmtKst(row.created_at)}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">사유: {row.memo || '—'}</p>
                  <p className="mt-1 text-xs text-amber-800">승인이 필요한 이유: {reason}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void approve(row)}
                      disabled={mine || busyId === row.id}
                      title={mine ? '만든 관리자나 대상은 승인할 수 없습니다.' : undefined}
                      className="rounded bg-primary-600 px-3 py-1 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      승인
                    </button>
                    {mine && (
                      <span className="text-xs text-gray-600">
                        내가 만들었거나 나에 대한 조정이라 다른 관리자가 승인해야 합니다.
                      </span>
                    )}
                    {cancelControls(row)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="adm-stale" data-testid="admin-timebank-stale">
        <h2 id="adm-stale" className="mb-2 text-lg font-semibold text-gray-900">
          {data.thresholds.stale_pending_days}일 넘은 대기 ({data.stale_pending.length})
        </h2>
        {data.stale_pending.length === 0 ? (
          <p className="text-sm text-gray-500">없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {data.stale_pending.map(row => (
              <li key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-sm text-gray-900">
                  {KIND_LABEL[row.kind]} · {fmtMinutes(row.minutes)} · {flowLabel(row)} · 기록{' '}
                  {fmtKst(row.created_at)}
                </p>
                {row.memo && <p className="mt-1 text-sm text-gray-600">{row.memo}</p>}
                <div className="mt-2">{cancelControls(row)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="adm-balances" data-testid="admin-timebank-accounts">
        <h2 id="adm-balances" className="mb-2 text-lg font-semibold text-gray-900">
          잔액표
        </h2>
        <p className="mb-3 text-sm text-gray-600">
          발행잔액(조합이 발행하고 아직 회수하지 않은 시간):{' '}
          <strong>{fmtMinutes(data.coop_outstanding_minutes)}</strong> · 플래그 기준: 잔액{' '}
          {fmtMinutes(data.thresholds.soft_max_minutes)} 초과,{' '}
          {fmtMinutes(data.thresholds.low_balance_flag_minutes)} 이하 · 플래그 {data.flagged_count}
          명
        </p>
        {data.accounts.length === 0 ? (
          <p className="text-sm text-gray-500">원장에 회원 계좌가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">조합원</th>
                  <th className="px-3 py-2 text-right font-medium">잔액</th>
                  <th className="px-3 py-2 font-medium">플래그</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.accounts.map(a => (
                  <tr key={a.member_id}>
                    <td className="px-3 py-2 text-gray-900">
                      {a.display_name || '—'}{' '}
                      <span className="text-xs text-gray-400">{a.member_id.slice(0, 8)}</span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${a.balance_minutes < 0 ? 'text-red-700' : 'text-gray-900'}`}
                    >
                      {fmtMinutes(a.balance_minutes)}
                    </td>
                    <td className="px-3 py-2">
                      {a.flags.includes('over_soft_max') && (
                        <span className="mr-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">
                          높은 잔액
                        </span>
                      )}
                      {a.flags.includes('low_balance') && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                          낮은 잔액
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
