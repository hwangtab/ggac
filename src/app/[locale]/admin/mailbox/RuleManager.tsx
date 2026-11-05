'use client'

import { useEffect, useState } from 'react'
import { FiX } from 'react-icons/fi'

import {
  RULE_ACTION_LABELS,
  normalizeRuleValue,
  type RuleAction,
  type RuleMatchType,
} from '@/lib/mail/senderRules'

import { LabelChip, type MailLabel } from './LabelManager'

type SenderRule = {
  id: string
  match_type: RuleMatchType
  match_value: string
  action: RuleAction
  label_id: string | null
  label_name: string | null
  label_color: string | null
}

type Preview = { matching_count: number; public_domain: boolean }

const inputClass =
  'rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'

/**
 * 발신자 규칙 창(관리자만 연다 — 라우트도 관리자만 받는다). 규칙 목록·지우기와 새 규칙 만들기.
 * 조건을 입력하면 맞는 기존 메일 수와 공용 메일 도메인 여부를 미리 보여 준다(서버가 같은 판정을 다시 한다).
 */
export default function RuleManager({
  labels,
  initial,
  onClose,
  onChanged,
}: {
  labels: MailLabel[]
  /** 발신자 카드에서 열면 그 주소로 채운다. */
  initial?: { matchType: RuleMatchType; matchValue: string }
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [rules, setRules] = useState<SenderRule[]>([])
  const [matchType, setMatchType] = useState<RuleMatchType>(initial?.matchType ?? 'address')
  const [matchValue, setMatchValue] = useState(initial?.matchValue ?? '')
  const [action, setAction] = useState<RuleAction>('spam')
  const [labelId, setLabelId] = useState('')
  const [applyExisting, setApplyExisting] = useState(true)
  const [confirmPublic, setConfirmPublic] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const normalized = normalizeRuleValue(matchType, matchValue)

  const loadRules = async () => {
    const res = await fetch('/api/admin/mailbox/rules')
    if (res.ok) setRules((await res.json())?.data?.rules ?? [])
  }

  useEffect(() => {
    loadRules().catch(() => undefined)
  }, [])

  // 조건이 바뀌면 잠시 뒤 미리보기를 다시 읽는다(타이핑마다 요청하지 않게).
  useEffect(() => {
    setPreview(null)
    setConfirmPublic(false)
    if (!normalized) return
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ match_type: matchType, match_value: normalized })
      fetch(`/api/admin/mailbox/rules/preview?${params}`)
        .then(res => (res.ok ? res.json() : null))
        .then(json => setPreview(json?.data ?? null))
        .catch(() => undefined)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [matchType, normalized])

  const create = async () => {
    setError(null)
    setNotice(null)
    if (!normalized) {
      setError(matchType === 'address' ? '메일 주소를 입력해 주세요.' : '도메인을 입력해 주세요.')
      return
    }
    if (action === 'label' && !labelId) {
      setError('붙일 라벨을 골라 주세요.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/mailbox/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_type: matchType,
          match_value: normalized,
          action,
          label_id: action === 'label' ? labelId : undefined,
          apply_existing: applyExisting,
          confirm_public_domain: confirmPublic,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '규칙을 만들지 못했습니다.')
      const applied = Number(json?.data?.applied_existing ?? 0)
      setNotice(
        applyExisting
          ? `규칙을 만들었습니다. 기존 메일 ${applied}통에 적용했습니다.`
          : '규칙을 만들었습니다.'
      )
      setMatchValue('')
      await loadRules()
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '규칙을 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (rule: SenderRule) => {
    if (!window.confirm('이 규칙을 지울까요? 이미 처리된 메일은 그대로 둡니다.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/mailbox/rules/${rule.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '규칙을 지우지 못했습니다.')
      await loadRules()
    } catch (err) {
      setError(err instanceof Error ? err.message : '규칙을 지우지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const needsPublicConfirm = preview?.public_domain === true

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="발신자 규칙"
        className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">발신자 규칙</h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-gray-500">
            받는 즉시 적용합니다. 같은 메일에 스팸과 보관이 함께 맞으면 스팸이 앞섭니다.
          </p>
          <div className="space-y-2 rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="조건 종류"
                value={matchType}
                onChange={e => setMatchType(e.target.value as RuleMatchType)}
                className={inputClass}
              >
                <option value="address">이 주소에서 온 메일</option>
                <option value="domain">이 도메인에서 온 메일</option>
              </select>
              <input
                aria-label="조건 값"
                value={matchValue}
                onChange={e => setMatchValue(e.target.value)}
                placeholder={matchType === 'address' ? 'ads@example.com' : 'example.com'}
                className={`${inputClass} flex-1 min-w-0`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-600">→</span>
              <select
                aria-label="동작"
                value={action}
                onChange={e => setAction(e.target.value as RuleAction)}
                className={inputClass}
              >
                {(['spam', 'archive', 'label'] as const).map(key => (
                  <option key={key} value={key} disabled={key === 'label' && labels.length === 0}>
                    {RULE_ACTION_LABELS[key]}
                  </option>
                ))}
              </select>
              {action === 'label' && (
                <select
                  aria-label="붙일 라벨"
                  value={labelId}
                  onChange={e => setLabelId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">라벨 고르기…</option>
                  {labels.map(label => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={applyExisting}
                onChange={e => setApplyExisting(e.target.checked)}
                className="rounded border-gray-300"
              />
              기존 메일에도 적용
              {preview && (
                <span className="text-gray-500" data-testid="rule-preview-count">
                  (맞는 메일 {preview.matching_count}통
                  {action !== 'label' ? ' — 안 읽음·읽음인 메일만 옮깁니다' : ''})
                </span>
              )}
            </label>
            {needsPublicConfirm && (
              <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                <input
                  type="checkbox"
                  checked={confirmPublic}
                  onChange={e => setConfirmPublic(e.target.checked)}
                  className="mt-0.5 rounded border-amber-300"
                />
                {normalized}은(는) 여러 사람이 쓰는 메일 서비스입니다. 도메인 전체에 걸면
                조합원·협력처 메일도 함께 처리됩니다. 이해했고 그래도 겁니다.
              </label>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy || !normalized || (needsPublicConfirm && !confirmPublic)}
                onClick={create}
                className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                규칙 만들기
              </button>
            </div>
          </div>

          {notice && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {rules.length === 0 ? (
            <p className="text-gray-500">아직 규칙이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="rule-list">
              {rules.map(rule => (
                <li key={rule.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="text-xs text-gray-500 shrink-0">
                    {rule.match_type === 'address' ? '주소' : '도메인'}
                  </span>
                  <span className="font-medium text-gray-800 break-all">
                    {rule.match_type === 'domain' ? `@${rule.match_value}` : rule.match_value}
                  </span>
                  <span className="text-gray-400">→</span>
                  {rule.action === 'label' && rule.label_name ? (
                    <LabelChip name={rule.label_name} color={rule.label_color ?? 'gray'} />
                  ) : (
                    <span className="text-gray-700">{RULE_ACTION_LABELS[rule.action]}</span>
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(rule)}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    지우기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
