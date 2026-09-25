'use client'

/**
 * 리워드 이행 패널 — 관리자 화면이라 한국어 전용이고 next-intl을 쓰지 않는다.
 *
 * 이 패널이 있는 이유는 셋이다.
 *
 * ① **한 번에 쓸어버린 표시를 보이게 한다.** 개설자가 캠페인 이틀째에 후원
 *    전부를 '발송 완료'로 눌러도 오늘 남는 것은 활동 기록 한 줄뿐이고 아무도
 *    그 줄을 읽지 않는다. 여기서는 표시 이력이 목록으로 보이고, 한 번에 거의
 *    전부를 올린 건에는 표가 붙는다. **표는 잘못의 증거가 아니라 볼 자리다.**
 * ② **잘못 누른 표시를 되돌린다.** 사유와 갈래를 적어야 통과하고, 그 문장이
 *    기록에 그대로 남는다. 개설자는 이 자리에 올 수 없다.
 * ③ **사무국이 대신 환불한다.** 후원자가 스스로 취소할 수 없게 된 건
 *    (마감된 캠페인, 발송 완료 표시)에서 토스 콘솔 대신 여기서 돌려준다 —
 *    콘솔에서 나간 환불은 원장이 모르고, 정산이 그 돈을 다시 지급하라고 한다.
 *
 * 처음에는 접혀 있고 펼칠 때 불러온다. 심사 목록에 수십 건이 걸릴 수 있어
 * 캠페인마다 조회를 하나씩 미리 쏘지 않는다(정산 패널과 다른 판단인 이유는
 * 그쪽이 마감된 캠페인에만 그려지기 때문이다).
 */

import { useCallback, useState } from 'react'

import {
  allowedReversalSourcesFor,
  FULFILLMENT_LABEL,
  FULFILLMENT_REVERSAL_KIND_LABEL,
  FULFILLMENT_REVERSAL_REASON_MIN,
  type FulfillmentReversalKind,
  type FulfillmentStatus,
} from '@/lib/funding/fulfillment'
import { OFFICE_REFUND_REASON_MIN } from '@/lib/funding/officeRefund'
import { apiErrorMessage } from '@/lib/funding/apiErrorMessage'

interface PledgeRow {
  id: string
  pledge_code: string
  backer_name: string
  status: string
  fulfillment_status: FulfillmentStatus
  reward_title: string
  quantity: number
  total_amount: number
  paid_at: string | null
}

interface MarkRow {
  id: string
  created_at: string
  actor: string
  to: string | null
  requested: number
  updated: number
  action: string
  kind: string | null
  reason: string | null
  sweeping: boolean
}

interface Payload {
  campaign: { id: string; title: string; status: string }
  fulfillable: boolean
  settlement_status: 'pending' | 'paid' | null
  counts: Record<FulfillmentStatus, number>
  pledges: PledgeRow[]
  marks: MarkRow[]
  mark_total: number
}

const STATUS_LABEL: Record<string, string> = {
  paid: '결제 완료',
  refunded: '환불됨',
  canceled: '취소 처리 중',
}

/** 되돌릴 수 있는 목표. `delivered`로 되돌리는 일은 실무에서 없다. */
const REVERSAL_TARGETS: FulfillmentStatus[] = ['none', 'preparing']

function won(n: number): string {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`
}

function when(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function FulfillmentPanel({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [target, setTarget] = useState<FulfillmentStatus>('none')
  const [kind, setKind] = useState<FulfillmentReversalKind>('wrong_row')
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/funding/campaigns/${campaignId}/fulfillment`)
      const json = await res.json()
      if (res.ok === false)
        throw new Error(apiErrorMessage(json, '이행 현황을 불러오지 못했습니다.'))
      setPayload(json.data as Payload)
      setSelected({})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  function toggle() {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && payload === null) void load()
  }

  /** 되돌릴 수 있는 후원 — 목표보다 뒤에 있고, 결제가 살아 있는 건. */
  function reversible(p: PledgeRow): boolean {
    return p.status === 'paid' && allowedReversalSourcesFor(target).includes(p.fulfillment_status)
  }

  const chosen = (payload?.pledges ?? []).filter(p => selected[p.id] === true && reversible(p))

  async function reverse() {
    if (chosen.length === 0) {
      setError('되돌릴 후원을 하나 이상 골라 주세요.')
      return
    }
    if (reason.trim().length < FULFILLMENT_REVERSAL_REASON_MIN) {
      setError(`되돌리는 사유를 ${FULFILLMENT_REVERSAL_REASON_MIN}자 이상 적어 주세요.`)
      return
    }
    // 경계 아래로 내려가는 건은 **자동 환불이 다시 열린다.** 원래 규칙이
    // 막으려던 바로 그 일이므로, 누르기 전에 그 말을 그대로 한다.
    const reopens =
      target === 'none' &&
      chosen.some(p => p.fulfillment_status === 'shipped' || p.fulfillment_status === 'delivered')
    const ok = window.confirm(
      `${chosen.length}건의 리워드 이행 상태를 '${FULFILLMENT_LABEL[target]}'으로 되돌립니다.\n` +
        `사유: ${reason.trim()}\n` +
        (reopens
          ? '\n발송 완료였던 건이 포함돼 있습니다. 되돌리면 해당 후원자는 다시 스스로 전액 취소를 할 수 있게 되고, 앞서 보낸 발송 안내를 정정하는 메일이 나갑니다.\n'
          : '') +
        '\n계속할까요?'
    )
    if (!ok) return

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/funding/campaigns/${campaignId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: target,
          kind,
          reason: reason.trim(),
          pledge_ids: chosen.map(p => p.id),
        }),
      })
      const json = await res.json()
      if (res.status === 409) {
        setError(apiErrorMessage(json, '상태가 이미 바뀌었습니다.'))
        await load()
        return
      }
      if (res.ok === false) throw new Error(apiErrorMessage(json, '되돌리지 못했습니다.'))
      const reopened = Number(json?.data?.reopened_self_cancel ?? 0)
      setNotice(
        `${Number(json?.data?.updated ?? 0)}건을 되돌렸습니다.` +
          (reopened > 0 ? ` 그중 ${reopened}건은 후원자의 직접 취소가 다시 열렸습니다.` : '')
      )
      setReason('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function refund(p: PledgeRow) {
    const input = window.prompt(
      `${p.pledge_code} (${p.backer_name}, ${won(p.total_amount)})을 전액 환불합니다.\n` +
        `환불 사유를 ${OFFICE_REFUND_REASON_MIN}자 이상 적어 주세요. 이 문장이 환불 기록에 남습니다.`,
      ''
    )
    if (input === null) return
    const text = input.trim()
    if (text.length < OFFICE_REFUND_REASON_MIN) {
      setError(`환불 사유를 ${OFFICE_REFUND_REASON_MIN}자 이상 적어 주세요.`)
      return
    }
    const settled = payload?.settlement_status === 'paid'
    const ok = window.confirm(
      `${won(p.total_amount)}을 후원자에게 돌려줍니다. 이 동작은 되돌릴 수 없습니다.\n` +
        (p.fulfillment_status === 'shipped' || p.fulfillment_status === 'delivered'
          ? '이 후원은 발송 완료로 표시돼 있습니다. 리워드가 실제로 나갔다면 물건과 돈을 둘 다 잃습니다.\n'
          : '') +
        (settled
          ? '이 프로젝트는 정산금 지급이 끝났습니다. 환불한 금액은 개설자에게서 되돌려 받아야 합니다.\n'
          : '') +
        '\n계속할까요?'
    )
    if (!ok) return

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/admin/funding/pledges/${p.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: text, ...(settled ? { acknowledge_settled: true } : {}) }),
      })
      const json = await res.json()
      if (res.ok === false) {
        // 409는 두 갈래다 — 그사이 상태가 움직였거나, 지급이 끝난 캠페인이라
        // 확인이 더 필요하거나. 서버가 문장으로 말해 주므로 그대로 쓰고
        // 목록을 다시 읽는다.
        setError(apiErrorMessage(json, '환불하지 못했습니다.'))
        if (res.status === 409) await load()
        return
      }
      setNotice(`${p.pledge_code} — ${won(Number(json?.data?.refund_amount ?? 0))}을 환불했습니다.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const sweeping = (payload?.marks ?? []).filter(m => m.sweeping)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="text-sm font-semibold text-gray-900 hover:text-primary-700"
      >
        리워드 이행·환불 {open ? '접기' : '보기'}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {loading && payload === null ? (
            <div className="h-20 animate-pulse rounded-lg bg-gray-100" />
          ) : payload === null ? (
            <p className="text-sm text-gray-500">{error ?? '불러오지 못했습니다.'}</p>
          ) : (
            <>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                  {notice}
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-xs">
                {(Object.keys(payload.counts) as FulfillmentStatus[]).map(s => (
                  <span
                    key={s}
                    className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700"
                  >
                    {FULFILLMENT_LABEL[s]} {payload.counts[s].toLocaleString('ko-KR')}
                  </span>
                ))}
              </div>

              {sweeping.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  한 번의 요청으로 후원자 대부분을 발송 완료로 옮긴 기록이{' '}
                  {sweeping.length.toLocaleString('ko-KR')}건 있습니다. 실제로 발송됐는지는 시스템이
                  알 수 없습니다 — 후원자 문의가 있거나 의심스러우면 개설자에게 확인한 뒤 아래에서
                  되돌릴 수 있습니다.
                </div>
              )}

              <section>
                <h4 className="mb-2 text-xs font-semibold text-gray-700">
                  이행 표시 기록 {payload.mark_total.toLocaleString('ko-KR')}건
                </h4>
                {payload.marks.length === 0 ? (
                  <p className="text-sm text-gray-500">아직 이행 표시가 없습니다.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-gray-600">
                    {payload.marks.map(m => (
                      <li
                        key={m.id}
                        className="rounded border border-gray-100 bg-gray-50 px-2 py-1"
                      >
                        <span className="font-mono">{when(m.created_at)}</span> · {m.actor} ·{' '}
                        {m.action === 'office_reversal' ? '되돌림 → ' : '→ '}
                        {typeof m.to === 'string' && m.to in FULFILLMENT_LABEL
                          ? FULFILLMENT_LABEL[m.to as FulfillmentStatus]
                          : (m.to ?? '—')}{' '}
                        · {m.updated.toLocaleString('ko-KR')}/{m.requested.toLocaleString('ko-KR')}
                        건
                        {m.sweeping && (
                          <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-amber-800">
                            한 번에 거의 전부
                          </span>
                        )}
                        {m.kind && (
                          <span className="ml-2 text-gray-500">
                            (
                            {FULFILLMENT_REVERSAL_KIND_LABEL[m.kind as FulfillmentReversalKind] ??
                              m.kind}
                            )
                          </span>
                        )}
                        {m.reason && <span className="ml-1 text-gray-500">— {m.reason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold text-gray-700">
                  후원 {payload.pledges.length.toLocaleString('ko-KR')}건
                </h4>
                {payload.pledges.length === 0 ? (
                  <p className="text-sm text-gray-500">결제된 후원이 없습니다.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded border border-gray-200">
                    {payload.pledges.map(p => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          disabled={busy || !reversible(p)}
                          checked={selected[p.id] === true}
                          onChange={e =>
                            setSelected(prev => ({ ...prev, [p.id]: e.target.checked }))
                          }
                          aria-label={`${p.pledge_code} 선택`}
                        />
                        <span className="font-mono text-gray-500">{p.pledge_code}</span>
                        <span className="text-gray-900">{p.backer_name}</span>
                        <span className="text-gray-600">
                          {p.reward_title} × {p.quantity}
                        </span>
                        <span className="text-gray-900">{won(p.total_amount)}</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                          {FULFILLMENT_LABEL[p.fulfillment_status] ?? p.fulfillment_status}
                        </span>
                        {p.status === 'paid' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void refund(p)}
                            className="ml-auto rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-700 disabled:opacity-50"
                          >
                            전액 환불
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <h4 className="mb-2 text-xs font-semibold text-gray-700">이행 표시 되돌리기</h4>
                <p className="mb-2 text-xs text-gray-600">
                  개설자는 발송 완료를 되돌릴 수 없습니다. 사무국만 할 수 있고, 무슨 일이었는지와
                  사유가 기록에 남습니다.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-600">
                    되돌릴 상태
                    <select
                      value={target}
                      disabled={busy}
                      onChange={e => setTarget(e.target.value as FulfillmentStatus)}
                      className="ml-1 rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      {REVERSAL_TARGETS.map(s => (
                        <option key={s} value={s}>
                          {FULFILLMENT_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">
                    무슨 일이었나
                    <select
                      value={kind}
                      disabled={busy}
                      onChange={e => setKind(e.target.value as FulfillmentReversalKind)}
                      className="ml-1 rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      {(
                        Object.keys(FULFILLMENT_REVERSAL_KIND_LABEL) as FulfillmentReversalKind[]
                      ).map(k => (
                        <option key={k} value={k}>
                          {FULFILLMENT_REVERSAL_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="text-xs text-gray-500">
                    고른 후원 {chosen.length.toLocaleString('ko-KR')}건
                  </span>
                </div>
                <textarea
                  value={reason}
                  disabled={busy}
                  onChange={e => setReason(e.target.value)}
                  rows={2}
                  placeholder="예: 개설자가 전체 선택으로 발송 완료를 눌렀으나 실제 발송은 아직입니다(전화 확인)."
                  className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  disabled={busy || chosen.length === 0}
                  onClick={() => void reverse()}
                  className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  되돌리기
                </button>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
