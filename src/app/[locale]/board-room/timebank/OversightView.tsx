'use client'

import { useEffect, useState } from 'react'
import { currentKstMonth, timebankFetch } from '@/components/timebank/timebankFormat'
import {
  fmtKst,
  fmtMinutes,
  type SettingsHistoryRow,
} from '@/components/timebank/timebankAdminFormat'
import TimebankSettingsHistory from '@/components/timebank/TimebankSettingsHistory'

type Oversight = {
  month: string
  issued: {
    signup_grant: number
    coop_task: number
    adjustment_credit: number
    redeem_refund: number
    withdrawal_settlement: number
    total: number
  }
  retired: {
    redeem: number
    adjustment_debit: number
    carryover: number
    withdrawal_settlement: number
    total: number
  }
  outstanding_minutes: number
  coop_task_by_member: Array<{ member_id: string; name: string | null; minutes: number }>
  adjustments: Array<{
    id: string
    status: 'pending' | 'confirmed' | 'rejected' | 'canceled'
    direction: 'credit' | 'debit'
    member_id: string
    member_name: string | null
    minutes: number
    memo: string | null
    created_by: string | null
    approved_by: string | null
    ref_type: string | null
    ref_id: string | null
    created_at: string | null
    decided_at: string | null
  }>
  negative_withdrawals: Array<{
    member_id: string
    member_name: string | null
    minutes: number
    decided_at: string | null
  }>
  actor_names: Record<string, string | null>
  settings_history: SettingsHistoryRow[]
  pilot: {
    exchange_count: number
    exchange_minutes: number
    participants: number | null
    bidirectional_participants: number | null
    rejected_count: number
    canceled_count: number
    stale_pending_count: number
    coop_task_minutes: number
    coop_task_ratio: number | null
    redeem_minutes: number
    redeem_ratio: number | null
    market_count: number
    over_soft_max_members: number | null
    low_balance_members: number | null
    min_bucket: number
    request_authors: number | null
    request_author_participants: number
    request_author_ratio: number | null
    outstanding_trend: Array<{ month: string; outstanding_minutes: number }>
  }
  thresholds: { soft_max_minutes: number; low_balance_flag_minutes: number }
}

const STATUS: Record<Oversight['adjustments'][number]['status'], string> = {
  pending: '승인 대기',
  confirmed: '확정',
  rejected: '거절',
  canceled: '취소',
}

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 1000) / 10}%`)

/**
 * 이사회·감사 타임뱅크 보고(스펙 §7.4·§9.2·§12). 월을 고르면 그달의 발행·회수·발행잔액,
 * 조정 전 건, 마이너스 탈퇴 정산, 운영 지표를 보인다. 설정 변경 이력(의결 근거)은 월과
 * 무관하게 최근 것부터.
 *
 * 조합 업무(발행 내역의 조합 업무 몫·조합 업무 비율·회원별 합계)는 조합 업무 스위치가
 * 켜졌을 때(`coopTasksOpen`)만 그린다 — 이사회가 조합 업무 크레딧을 두지 않기로 해
 * 기본은 꺼짐이다. API 응답 모양은 그대로다.
 *
 * 사람 수를 세는 칸은 3명 미만이면 서버가 가린다("3명 미만"으로 표시).
 */
export default function OversightView({ coopTasksOpen }: { coopTasksOpen: boolean }) {
  const [month, setMonth] = useState(() => currentKstMonth())
  const [data, setData] = useState<Oversight | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return
    let alive = true
    void timebankFetch<Oversight>(
      `/api/board-room/timebank/oversight?month=${encodeURIComponent(month)}`,
      {},
      '타임뱅크 보고를 불러오지 못했습니다.'
    ).then(result => {
      if (!alive) return
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else setError(result.error)
    })
    return () => {
      alive = false
    }
  }, [month])

  const people = (n: number | null) =>
    n === null ? `${data?.pilot.min_bucket ?? 3}명 미만` : `${n}명`
  const actor = (id: string | null) =>
    id ? (data?.actor_names[id] ?? null) || id.slice(0, 8) : '—'

  const card = (label: string, value: string, sub?: string) => (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  )

  return (
    <div className="space-y-8" data-testid="board-timebank-oversight">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">타임뱅크 보고</h1>
          <p className="mt-1 text-sm text-gray-600">
            조합 계좌가 회원에게 주면 발행, 회원이 조합에 주면 회수(소멸)입니다. 발행잔액은 발행하고
            아직 회수하지 않은 시간입니다.
          </p>
        </div>
        <label className="text-sm text-gray-700">
          월(KST)
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
            data-testid="board-timebank-month"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <div className="h-40 animate-pulse rounded-lg bg-gray-100" />}

      {data && (
        <>
          <section aria-labelledby="ov-flows">
            <h2 id="ov-flows" className="mb-3 text-lg font-semibold text-gray-900">
              {data.month} 발행·회수
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {card(
                '발행',
                fmtMinutes(data.issued.total),
                [
                  `가입 ${fmtMinutes(data.issued.signup_grant)}`,
                  coopTasksOpen ? `조합 업무 ${fmtMinutes(data.issued.coop_task)}` : null,
                  `조정+ ${fmtMinutes(data.issued.adjustment_credit)}`,
                  `탈퇴 정산 ${fmtMinutes(data.issued.withdrawal_settlement)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              )}
              {card(
                '회수',
                fmtMinutes(data.retired.total),
                `조정− ${fmtMinutes(data.retired.adjustment_debit)} · 재가입 승계 ${fmtMinutes(data.retired.carryover)} · 탈퇴 정산 ${fmtMinutes(data.retired.withdrawal_settlement)}`
              )}
              {card('월말 발행잔액', fmtMinutes(data.outstanding_minutes))}
            </div>
          </section>

          <section aria-labelledby="ov-pilot" data-testid="board-timebank-pilot">
            <h2 id="ov-pilot" className="mb-3 text-lg font-semibold text-gray-900">
              운영 지표
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {card(
                '확정 교환',
                `${data.pilot.exchange_count}건`,
                fmtMinutes(data.pilot.exchange_minutes)
              )}
              {card(
                '양방향 참여자',
                people(data.pilot.bidirectional_participants),
                '그달 말까지 확정 교환에서 주고 받은 적이 모두 있는 사람'
              )}
              {card('그달 교환 참여자', people(data.pilot.participants))}
              {card(
                '요청 글을 쓴 조합원 비율',
                pct(data.pilot.request_author_ratio),
                `작성자 ${people(data.pilot.request_authors)} / 참여자 ${data.pilot.request_author_participants}명`
              )}
              {coopTasksOpen &&
                card(
                  '조합 업무 비율',
                  pct(data.pilot.coop_task_ratio),
                  `조합 업무 ${fmtMinutes(data.pilot.coop_task_minutes)} / (조합 업무 + 교환)`
                )}
              {card(
                '거절·취소',
                `${data.pilot.rejected_count}건 · ${data.pilot.canceled_count}건`,
                `지금 7일 넘은 대기 ${data.pilot.stale_pending_count}건`
              )}
              {card(
                '잔액 분포(지금)',
                `${people(data.pilot.over_soft_max_members)} · ${people(data.pilot.low_balance_members)}`,
                `${fmtMinutes(data.thresholds.soft_max_minutes)} 초과 · ${fmtMinutes(data.thresholds.low_balance_flag_minutes)} 이하`
              )}
              {card(
                '조합 서비스 비율',
                pct(data.pilot.redeem_ratio),
                `조합 서비스 ${fmtMinutes(data.pilot.redeem_minutes)} · 장터 시간 거래 ${data.pilot.market_count}건 (1-B에서 엽니다)`
              )}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="board-timebank-trend">
                <caption className="mb-1 text-left text-sm font-medium text-gray-700">
                  발행잔액 추이(월말)
                </caption>
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    {data.pilot.outstanding_trend.map(r => (
                      <th key={r.month} className="px-3 py-2 font-medium">
                        {r.month}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {data.pilot.outstanding_trend.map(r => (
                      <td key={r.month} className="px-3 py-2 text-gray-900">
                        {fmtMinutes(r.outstanding_minutes)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {coopTasksOpen && (
            <section aria-labelledby="ov-coop" data-testid="board-timebank-coop">
              <h2 id="ov-coop" className="mb-2 text-lg font-semibold text-gray-900">
                조합 업무 회원별 합계
              </h2>
              {data.coop_task_by_member.length === 0 ? (
                <p className="text-sm text-gray-500">이달 조합 업무 지급이 없습니다.</p>
              ) : (
                <table className="min-w-full rounded-lg border border-gray-200 bg-white text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">조합원</th>
                      <th className="px-3 py-2 text-right font-medium">합계</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.coop_task_by_member.map(r => (
                      <tr key={r.member_id}>
                        <td className="px-3 py-2">{r.name || r.member_id.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right">{fmtMinutes(r.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          <section aria-labelledby="ov-adjust" data-testid="board-timebank-adjustments">
            <h2 id="ov-adjust" className="mb-2 text-lg font-semibold text-gray-900">
              조정 전 건
            </h2>
            {data.adjustments.length === 0 ? (
              <p className="text-sm text-gray-500">이달 조정이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full rounded-lg border border-gray-200 bg-white text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">시각</th>
                      <th className="px-3 py-2 font-medium">대상</th>
                      <th className="px-3 py-2 font-medium">방향·시간</th>
                      <th className="px-3 py-2 font-medium">사유</th>
                      <th className="px-3 py-2 font-medium">만든 관리자</th>
                      <th className="px-3 py-2 font-medium">승인자</th>
                      <th className="px-3 py-2 font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.adjustments.map(a => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {fmtKst(a.decided_at ?? a.created_at)}
                        </td>
                        <td className="px-3 py-2">{a.member_name || a.member_id.slice(0, 8)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {a.direction === 'credit' ? '적립' : '차감'} {fmtMinutes(a.minutes)}
                        </td>
                        <td className="px-3 py-2">
                          {a.memo || '—'}
                          {a.ref_type === 'dispute' && (
                            <span className="block text-xs text-gray-500">
                              분쟁 정리 · 근거 {a.ref_id}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{actor(a.created_by)}</td>
                        <td className="px-3 py-2">{actor(a.approved_by)}</td>
                        <td className="px-3 py-2">{STATUS[a.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="ov-negative">
            <h2 id="ov-negative" className="mb-2 text-lg font-semibold text-gray-900">
              마이너스 탈퇴 정산
            </h2>
            {data.negative_withdrawals.length === 0 ? (
              <p className="text-sm text-gray-500">
                이달 마이너스 잔액으로 탈퇴한 조합원이 없습니다.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.negative_withdrawals.map((w, i) => (
                  <li key={`${w.member_id}-${i}`}>
                    {fmtKst(w.decided_at)} · {w.member_name || '탈퇴한 조합원'} · 조합이 떠안은 시간{' '}
                    {fmtMinutes(w.minutes)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ov-settings">
            <h2 id="ov-settings" className="mb-2 text-lg font-semibold text-gray-900">
              설정 변경 이력(의결 근거)
            </h2>
            <TimebankSettingsHistory history={data.settings_history} />
          </section>
        </>
      )}
    </div>
  )
}
