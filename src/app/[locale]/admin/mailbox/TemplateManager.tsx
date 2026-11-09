'use client'

import { useDialogA11y } from '@/hooks/useDialogA11y'
import { useCallback, useId, useRef, useState } from 'react'
import { FiX } from 'react-icons/fi'

import {
  TEMPLATE_BODY_MAX,
  TEMPLATE_NAME_MAX,
  appendTemplate,
  normalizeTemplateBody,
  normalizeTemplateName,
} from '@/lib/mail/replyTemplates'

export type ReplyTemplate = { id: string; name: string; body: string }

const inputClass =
  'w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'

/**
 * 작성 창의 "템플릿 넣기" — 고르면 쓰던 본문 끝에 덧붙인다(쓰던 글을 지우지 않는다). 템플릿이 없으면 그리지 않는다.
 */
export function TemplatePicker({
  templates,
  disabled,
  body,
  onChange,
}: {
  templates: ReplyTemplate[]
  disabled?: boolean
  body: string
  onChange: (next: string) => void
}) {
  if (templates.length === 0) return null
  return (
    <select
      aria-label="템플릿 넣기"
      disabled={disabled}
      value=""
      onChange={e => {
        const picked = templates.find(t => t.id === e.target.value)
        if (picked) onChange(appendTemplate(body, picked.body))
      }}
      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
    >
      <option value="">템플릿 넣기…</option>
      {templates.map(t => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

/** 답장 템플릿 관리 창(관리자만 연다 — 라우트도 관리자만 받는다). 만들기·고치기·지우기. */
export default function TemplateManager({
  templates,
  onClose,
  onChanged,
}: {
  templates: ReplyTemplate[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState<{ id: string | null; name: string; body: string } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!editing) return
    const name = normalizeTemplateName(editing.name)
    const body = normalizeTemplateBody(editing.body)
    if (!name) {
      setError(`이름은 1~${TEMPLATE_NAME_MAX}자로 입력해 주세요.`)
      return
    }
    if (!body) {
      setError(`내용은 1~${TEMPLATE_BODY_MAX}자로 입력해 주세요.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        editing.id ? `/api/admin/mailbox/templates/${editing.id}` : '/api/admin/mailbox/templates',
        {
          method: editing.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, body }),
        }
      )
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '템플릿을 저장하지 못했습니다.')
      setEditing(null)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '템플릿을 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (template: ReplyTemplate) => {
    if (!window.confirm(`"${template.name}" 템플릿을 지울까요?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/mailbox/templates/${template.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || '템플릿을 지우지 못했습니다.')
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '템플릿을 지우지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const handleEscape = useCallback(() => {
    if (!busyRef.current) onCloseRef.current()
  }, [])
  useDialogA11y({ containerRef: dialogRef, onClose: handleEscape })
  const titleId = useId()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            답장 템플릿
          </h2>
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
            답장·새 메일 작성 창의 "템플릿 넣기"에서 고르면 쓰던 본문 끝에 덧붙습니다.
          </p>
          {editing ? (
            <div className="space-y-2 rounded-lg bg-gray-50 p-3">
              <input
                aria-label="템플릿 이름"
                value={editing.name}
                maxLength={TEMPLATE_NAME_MAX}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="예: 대관 안내"
                className={inputClass}
              />
              <textarea
                aria-label="템플릿 내용"
                rows={8}
                value={editing.body}
                maxLength={TEMPLATE_BODY_MAX}
                onChange={e => setEditing({ ...editing, body: e.target.value })}
                className={`${inputClass} resize-y`}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                  className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={save}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing({ id: null, name: '', body: '' })}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700"
            >
              새 템플릿
            </button>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {templates.length === 0 ? (
            <p className="text-gray-500">아직 템플릿이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="template-list">
              {templates.map(template => (
                <li key={template.id} className="py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 flex-1 min-w-0 truncate">
                      {template.name}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setEditing({ id: template.id, name: template.name, body: template.body })
                      }
                      className="text-xs text-primary-700 hover:underline"
                    >
                      고치기
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(template)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      지우기
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-2">
                    {template.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
