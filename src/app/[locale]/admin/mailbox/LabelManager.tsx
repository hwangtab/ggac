'use client'

import { useState } from 'react'
import { FiX } from 'react-icons/fi'

import {
  LABEL_NAME_MAX,
  MAIL_LABEL_COLORS,
  labelColorClass,
  normalizeLabelName,
  type MailLabelColor,
} from '@/lib/mail/labels'

export type MailLabel = { id: string; name: string; color: string; email_count: number }

const COLOR_NAMES: Record<MailLabelColor, string> = {
  gray: '회색',
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
}

const COLOR_KEYS = Object.keys(MAIL_LABEL_COLORS) as MailLabelColor[]

const inputClass =
  'rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${labelColorClass(color)}`}
    >
      {name}
    </span>
  )
}

/**
 * 라벨 관리 창(관리자만 연다 — 라우트도 관리자만 받는다). 만들기·이름·색 바꾸기·지우기. 바꿀 때마다 `onChanged`로
 * 목록을 다시 읽게 한다(메일 행의 칩 이름·색도 함께 바뀐다).
 */
export default function LabelManager({
  labels,
  onClose,
  onChanged,
}: {
  labels: MailLabel[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<MailLabelColor>('blue')
  const [edits, setEdits] = useState<Record<string, { name: string; color: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async (url: string, init: RequestInit, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || fallback)
      await onChanged()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const name = normalizeLabelName(newName)
    if (!name) {
      setError(`라벨 이름은 1~${LABEL_NAME_MAX}자로 입력해 주세요.`)
      return
    }
    const ok = await call(
      '/api/admin/mailbox/labels',
      { method: 'POST', body: JSON.stringify({ name, color: newColor }) },
      '라벨을 만들지 못했습니다.'
    )
    if (ok) setNewName('')
  }

  const save = async (label: MailLabel) => {
    const edit = edits[label.id]
    if (!edit) return
    const ok = await call(
      `/api/admin/mailbox/labels/${label.id}`,
      { method: 'PATCH', body: JSON.stringify({ name: edit.name, color: edit.color }) },
      '라벨을 바꾸지 못했습니다.'
    )
    if (ok) setEdits(({ [label.id]: _done, ...rest }) => rest)
  }

  const remove = async (label: MailLabel) => {
    const warning =
      label.email_count > 0
        ? `"${label.name}" 라벨을 지울까요? 메일 ${label.email_count}통에서 이 라벨이 빠집니다(메일은 그대로입니다).`
        : `"${label.name}" 라벨을 지울까요?`
    if (!window.confirm(warning)) return
    await call(
      `/api/admin/mailbox/labels/${label.id}`,
      { method: 'DELETE' },
      '라벨을 지우지 못했습니다.'
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="라벨 관리"
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">라벨 관리</h2>
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
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="새 라벨 이름"
              value={newName}
              maxLength={LABEL_NAME_MAX}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') create()
              }}
              placeholder="예: 총회, 후원, 언론"
              className={`${inputClass} flex-1 min-w-0`}
            />
            <select
              aria-label="새 라벨 색"
              value={newColor}
              onChange={e => setNewColor(e.target.value as MailLabelColor)}
              className={inputClass}
            >
              {COLOR_KEYS.map(key => (
                <option key={key} value={key}>
                  {COLOR_NAMES[key]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={create}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              만들기
            </button>
          </div>

          {labels.length === 0 ? (
            <p className="text-gray-500">아직 라벨이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {labels.map(label => {
                const edit = edits[label.id]
                const name = edit?.name ?? label.name
                const color = edit?.color ?? label.color
                return (
                  <li key={label.id} className="flex flex-wrap items-center gap-2 py-2">
                    <LabelChip name={name || label.name} color={color} />
                    <input
                      aria-label={`${label.name} 이름`}
                      value={name}
                      maxLength={LABEL_NAME_MAX}
                      onChange={e =>
                        setEdits(prev => ({ ...prev, [label.id]: { name: e.target.value, color } }))
                      }
                      className={`${inputClass} flex-1 min-w-0`}
                    />
                    <select
                      aria-label={`${label.name} 색`}
                      value={color}
                      onChange={e =>
                        setEdits(prev => ({ ...prev, [label.id]: { name, color: e.target.value } }))
                      }
                      className={inputClass}
                    >
                      {COLOR_KEYS.map(key => (
                        <option key={key} value={key}>
                          {COLOR_NAMES[key]}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400 w-12 text-right">
                      {label.email_count}통
                    </span>
                    {edit && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => save(label)}
                        className="text-xs text-primary-700 hover:underline disabled:opacity-50"
                      >
                        저장
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(label)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      지우기
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
