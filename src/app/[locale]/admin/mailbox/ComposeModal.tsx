'use client'

import { useRef, useState } from 'react'
import { FiPaperclip, FiX } from 'react-icons/fi'

import { classifyFailedResponse } from '@/lib/mail/composeOutcome'
import {
  COMPOSE_LIMITS,
  isBlockedAttachmentName,
  normalizeAddress,
  validateAttachments,
  validateCompose,
  validateForwardAttachments,
} from '@/lib/mail/composeValidation'

import { escapeHtml, formatBytes } from './mailboxUtils'
import { TemplatePicker, type ReplyTemplate } from './TemplateManager'

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500'

/** 조합 도메인이 아닌 주소는 확인 단계에서 강조한다. */
const OWN_DOMAINS = ['ggac.kr']

type Quota = { used: number; limit: number } | null

type Props = {
  quota: Quota
  onClose: () => void
  /** 발송이 끝났다(나갔거나, 나갔는지 확인해야 하는 상태). 목록을 새로 읽는 데 쓴다. */
  onDone: () => void
  /** 받는 사람을 미리 채운다(발신자 카드의 "메일 쓰기"). 발송 전에 서버가 다시 검증한다. */
  initialTo?: string[]
  /** 받은 메일 전달. 제목·본문을 미리 채우고, 고른 받은 첨부는 서버가 비공개 저장소에서 복사해 붙인다. */
  forward?: ForwardSource
  /** 답장 템플릿 — "템플릿 넣기"로 본문 끝에 덧붙인다. */
  templates?: ReplyTemplate[]
}

export type ForwardSource = {
  emailId: string
  subject: string
  body: string
  attachments: { id: string; filename: string; size_bytes: number | null; inline: boolean }[]
}

type Outcome = { tone: 'ok' | 'warn'; message: string }

/**
 * 받는 사람 입력 — 쉼표·세미콜론·공백·엔터로 칩을 만든다.
 * 잘못된 주소는 칩이 되지 않고 입력창 아래에 이유가 뜬다.
 */
function AddressField({
  label,
  values,
  max,
  disabled,
  onChange,
  autoFocus,
}: {
  label: string
  values: string[]
  max: number
  disabled: boolean
  onChange: (next: string[]) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).filter(Boolean)
    if (parts.length === 0) {
      setText('')
      return
    }
    const next = [...values]
    let bad: string | null = null
    for (const part of parts) {
      const address = normalizeAddress(part)
      if (!address) {
        bad = part
        continue
      }
      if (next.includes(address)) continue
      if (next.length >= max) {
        setProblem(`${label}는 ${max}명까지 입력할 수 있습니다.`)
        onChange(next)
        setText('')
        return
      }
      next.push(address)
    }
    onChange(next)
    setProblem(bad ? `올바르지 않은 주소입니다: ${bad}` : null)
    setText(bad ?? '')
  }

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 px-2 py-1.5 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500">
        {values.map(address => (
          <span
            key={address}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800"
          >
            {address}
            <button
              type="button"
              disabled={disabled}
              aria-label={`${address} 삭제`}
              onClick={() => onChange(values.filter(v => v !== address))}
              className="text-gray-400 hover:text-gray-700"
            >
              <FiX className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          inputMode="email"
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          onChange={e => {
            const value = e.target.value
            if (/[,;\s]/.test(value)) commit(value)
            else setText(value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(text)
            } else if (e.key === 'Backspace' && text === '' && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => commit(text)}
          placeholder={values.length === 0 ? 'name@example.com' : ''}
          className="min-w-[10rem] flex-1 border-0 bg-transparent p-0.5 text-sm focus:outline-none focus:ring-0"
        />
      </div>
      {problem && <p className="text-xs text-red-600">{problem}</p>}
    </div>
  )
}

function isExternal(address: string): boolean {
  const domain = address.split('@')[1] ?? ''
  return !OWN_DOMAINS.includes(domain)
}

/**
 * 새 메일 작성 모달 — 관리자만 그린다(`canManage && compose_enabled`).
 *
 * 되돌릴 수 없는 일이라 **확인 단계를 건너뛰는 길이 없다**: "다음" → 수신자 전체와 외부 도메인을 보여 주는
 * 확인 화면 → "N명에게 보내기"뿐이다.
 *
 * `idempotency_key`는 이 모달이 열릴 때 한 번 만든다. 서버가 이 키로 중복 발송을 막으므로 키의 수명이 곧
 * 중복 방지다:
 *  - 유지: 성공, "처리 중/확인 필요"(409), 네트워크 오류(요청이 닿았는지 모른다 — 같은 키로 다시 보내도 안전하다).
 *  - 새로 발급: 서버가 거절했다(검증 실패·상한 초과·발송 거절). 이 키의 행은 이미 끝난 상태라 재사용할 수 없다.
 */
export default function ComposeModal({
  quota,
  onClose,
  onDone,
  initialTo,
  forward,
  templates = [],
}: Props) {
  const keyRef = useRef<string>(crypto.randomUUID())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [to, setTo] = useState<string[]>(() => initialTo ?? [])
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [subject, setSubject] = useState(() => forward?.subject ?? '')
  const [body, setBody] = useState(() => forward?.body ?? '')
  const [files, setFiles] = useState<File[]>([])
  // 전달할 받은 첨부 — 기본은 진짜 첨부만 고른다. 본문에 박힌 인라인 이미지(서명 로고 등)는 꺼 두고, 내보낼 수
  // 없는 형식(실행 파일)은 아예 고를 수 없게 그린다 — 기본으로 골라 두면 창을 열자마자 오류부터 뜬다.
  const [forwardIds, setForwardIds] = useState<string[]>(
    () =>
      forward?.attachments
        .filter(a => !a.inline && !isBlockedAttachmentName(a.filename))
        .map(a => a.id) ?? []
  )
  const forwardPicked = (forward?.attachments ?? []).filter(a => forwardIds.includes(a.id))
  const forwardCheck = forward
    ? validateForwardAttachments(
        forwardPicked.map(a => ({ id: a.id, name: a.filename, size: a.size_bytes })),
        files.length
      )
    : null

  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // 결과를 알 수 없는 실패(응답 유실·처리 중) 뒤에는 입력을 잠근다. 키를 유지한 채 내용을 고치면 서버는 이전
  // 행만 보고 "이미 보낸 메일"이라고 답해, 고친 내용이 나간 것처럼 보이기 때문이다.
  const [locked, setLocked] = useState(false)
  const frozen = sending || locked

  const validated = validateCompose({ to, cc, bcc, subject })
  const bodyOk = body.trim().length > 0
  const remaining = quota ? Math.max(quota.limit - quota.used, 0) : null

  const goConfirm = () => {
    setError(null)
    if (validated.ok === false) {
      setError(validated.error)
      return
    }
    if (!bodyOk) {
      setError('본문을 입력해 주세요.')
      return
    }
    const attachmentCheck = validateAttachments(files.map(f => ({ name: f.name, size: f.size })))
    if (attachmentCheck.ok === false) {
      setError(attachmentCheck.error)
      return
    }
    if (forwardCheck && forwardCheck.ok === false) {
      setError(forwardCheck.error)
      return
    }
    if (remaining !== null && validated.value.recipientCount > remaining) {
      setError(
        `오늘 남은 발송량(${remaining}명)보다 수신자가 많습니다. 수신자를 줄이거나 내일 보내 주세요.`
      )
      return
    }
    setStep('confirm')
  }

  const addFiles = (picked: FileList | null) => {
    if (!picked) return
    const next = [...files, ...Array.from(picked)]
    const check = validateAttachments(next.map(f => ({ name: f.name, size: f.size })))
    if (check.ok === false) {
      setError(check.error)
    } else {
      setError(null)
      setFiles(next)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // 바깥 클릭·Esc·X 한 번으로 쓰던 내용이 사라지지 않게 한다. 이미 보낸 뒤(outcome)에는 묻지 않는다.
  const dirty =
    to.length > 0 ||
    cc.length > 0 ||
    bcc.length > 0 ||
    subject.trim() !== '' ||
    body.trim() !== '' ||
    files.length > 0

  const close = () => {
    if (sending) return
    if (!outcome && locked) {
      // 결과를 모르는 요청이 있는 채로 닫으면 다시 열 때 새 요청 키가 만들어진다 — 그 메일이 이미 나갔다면
      // 같은 메일이 두 번 나간다. 일반 "내용이 사라진다" 경고보다 이쪽이 더 중요하다.
      if (
        !window.confirm(
          '결과를 확인하지 못한 메일이 있습니다. 닫은 뒤 다시 쓰면 같은 메일이 두 번 나갈 수 있습니다. 먼저 보낸 편지함에서 이미 나갔는지 확인하셨나요? 그래도 닫을까요?'
        )
      ) {
        return
      }
    } else if (!outcome && dirty && !window.confirm('작성 중인 내용이 사라집니다. 닫을까요?')) {
      return
    }
    onClose()
  }

  const startOver = () => {
    if (
      !window.confirm(
        '이전 시도가 이미 나갔는지 보낸 편지함에서 확인하셨나요? 확인 없이 새로 쓰면 같은 메일이 두 번 나갈 수 있습니다.'
      )
    ) {
      return
    }
    keyRef.current = crypto.randomUUID()
    setLocked(false)
    setError(null)
  }

  const send = async () => {
    if (validated.ok === false || sending) return
    setSending(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('idempotency_key', keyRef.current)
      form.set('to', JSON.stringify(validated.value.to))
      form.set('cc', JSON.stringify(validated.value.cc))
      form.set('bcc', JSON.stringify(validated.value.bcc))
      form.set('subject', validated.value.subject)
      // 평문 입력을 HTML로 보낸다 — 이스케이프하고 개행을 <br>로 바꾸지 않으면 문단이 붙어 나간다.
      form.set('body_html', escapeHtml(body).replace(/\n/g, '<br>'))
      for (const file of files) form.append('attachments', file)
      if (forward) {
        form.set('forward_of', forward.emailId)
        form.set('forward_attachment_ids', JSON.stringify(forwardPicked.map(a => a.id)))
      }

      const res = await fetch('/api/admin/mailbox/outbound', { method: 'POST', body: form })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        // 서버가 JSON으로 판단을 끝냈을 때만 새 키를 쓴다. 플랫폼 504 같은 JSON 아닌 응답은 메일이 이미
        // 나갔는데 응답만 잃은 것일 수 있다 — 새 키로 다시 누르면 같은 메일이 두 번 나간다.
        if (classifyFailedResponse(res.status, json) === 'rotate-key') {
          keyRef.current = crypto.randomUUID()
          setError(json?.error || '메일을 보내지 못했습니다.')
        } else {
          setLocked(true)
          setError(
            json?.error ||
              `서버가 응답을 끝내지 못했습니다(${res.status}). 메일이 이미 나갔을 수 있으니 보낸 편지함을 먼저 확인해 주세요.`
          )
        }
        setStep('edit')
        return
      }

      const data = json?.data
      onDone()
      if (data?.status === 'unknown') {
        setOutcome({
          tone: 'warn',
          message:
            '메일이 나갔는지 확인할 수 없습니다. 같은 메일을 다시 보내지 마세요. 보낸 편지함과 Resend 대시보드에서 확인해 주세요.',
        })
      } else if (data?.recorded === false) {
        setOutcome({
          tone: 'warn',
          message:
            '메일은 나갔지만 기록에 실패했습니다. 다시 보내지 말고 관리자에게 보낸 기록 확인을 요청해 주세요.',
        })
      } else {
        setOutcome({
          tone: 'ok',
          message: data?.duplicate ? '이미 보낸 메일입니다.' : '메일을 보냈습니다.',
        })
      }
    } catch {
      // 요청이 서버에 닿았는지 모른다. 키를 유지하므로 다시 눌러도 중복 발송되지 않는다.
      setLocked(true)
      setError(
        '연결이 끊겨 결과를 확인하지 못했습니다. 보낸 편지함을 확인한 뒤, 없으면 다시 보내기를 눌러 주세요(같은 요청으로 처리되어 중복 발송되지 않습니다).'
      )
      setStep('edit')
    } finally {
      setSending(false)
    }
  }

  const count = validated.ok ? validated.value.recipientCount : 0
  const lists: { label: string; values: string[] }[] = validated.ok
    ? [
        { label: '받는 사람', values: validated.value.to },
        { label: '참조', values: validated.value.cc },
        { label: '숨은참조', values: validated.value.bcc },
      ].filter(l => l.values.length > 0)
    : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="새 메일 작성"
      onClick={e => {
        if (e.target === e.currentTarget) close()
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') close()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900">
            {step === 'confirm' ? '보내기 전에 확인해 주세요' : forward ? '메일 전달' : '새 메일'}
          </h2>
          <button
            onClick={close}
            disabled={sending}
            aria-label="닫기"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        {outcome ? (
          <div className="space-y-4 p-5">
            <p
              className={`rounded-lg border p-3 text-sm ${
                outcome.tone === 'ok'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {outcome.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
              >
                닫기
              </button>
            </div>
          </div>
        ) : step === 'edit' ? (
          <>
            <div className="space-y-4 p-5">
              <AddressField
                label="받는 사람"
                values={to}
                max={COMPOSE_LIMITS.maxTo}
                disabled={frozen}
                onChange={setTo}
                autoFocus
              />
              {showCcBcc ? (
                <>
                  <AddressField
                    label="참조"
                    values={cc}
                    max={COMPOSE_LIMITS.maxCc}
                    disabled={frozen}
                    onChange={setCc}
                  />
                  <AddressField
                    label="숨은참조"
                    values={bcc}
                    max={COMPOSE_LIMITS.maxBcc}
                    disabled={frozen}
                    onChange={setBcc}
                  />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCcBcc(true)}
                  className="text-xs text-primary-600 hover:underline"
                >
                  참조·숨은참조 추가
                </button>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">
                  제목 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  maxLength={COMPOSE_LIMITS.subjectMax}
                  onChange={e => setSubject(e.target.value)}
                  disabled={frozen}
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-gray-600">
                    본문 <span className="text-red-500">*</span>
                  </label>
                  <TemplatePicker
                    templates={templates}
                    disabled={frozen}
                    body={body}
                    onChange={setBody}
                  />
                </div>
                <textarea
                  rows={10}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  disabled={frozen}
                  placeholder="내용을 입력하세요."
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={frozen || files.length >= COMPOSE_LIMITS.maxAttachments}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    <FiPaperclip className="h-3 w-3" />
                    파일 첨부
                  </button>
                  <span className="text-xs text-gray-400">
                    최대 {COMPOSE_LIMITS.maxAttachments}개, 합쳐서{' '}
                    {Math.floor(COMPOSE_LIMITS.maxAttachmentTotalBytes / 1_000_000)}MB
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => addFiles(e.target.files)}
                  />
                </div>
                {forward && forward.attachments.length > 0 && (
                  <fieldset className="space-y-1" data-testid="forward-attachments">
                    <legend className="text-xs font-medium text-gray-600">
                      전달할 원본 첨부 (합쳐서{' '}
                      {Math.floor(COMPOSE_LIMITS.maxForwardTotalBytes / 1_000_000)}MB까지)
                    </legend>
                    {forward.attachments.map(att => {
                      const blocked = isBlockedAttachmentName(att.filename)
                      return (
                        <label
                          key={att.id}
                          className={`flex items-center gap-2 rounded bg-gray-50 px-2 py-1 text-xs ${
                            blocked ? 'text-gray-400' : 'text-gray-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={frozen || blocked}
                            checked={forwardIds.includes(att.id)}
                            onChange={e =>
                              setForwardIds(ids =>
                                e.target.checked
                                  ? [...ids, att.id]
                                  : ids.filter(id => id !== att.id)
                              )
                            }
                            className="rounded border-gray-300"
                          />
                          <span className="truncate">
                            {att.filename}{' '}
                            <span className="text-gray-400">
                              ({formatBytes(att.size_bytes)}
                              {att.inline ? ', 본문 이미지' : ''}
                              {blocked ? ', 보낼 수 없는 형식' : ''})
                            </span>
                          </span>
                        </label>
                      )
                    })}
                    {forwardCheck && forwardCheck.ok === false && (
                      <p className="text-xs text-amber-700">{forwardCheck.error}</p>
                    )}
                  </fieldset>
                )}
                {files.length > 0 && (
                  <ul className="space-y-1">
                    {files.map((file, i) => (
                      <li
                        key={`${file.name}-${i}`}
                        className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs text-gray-700"
                      >
                        <span className="truncate">
                          {file.name}{' '}
                          <span className="text-gray-400">({formatBytes(file.size)})</span>
                        </span>
                        <button
                          type="button"
                          disabled={frozen}
                          aria-label={`${file.name} 삭제`}
                          onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                          className="ml-2 text-gray-400 hover:text-gray-700"
                        >
                          <FiX className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {remaining !== null && (
                <p className="text-xs text-gray-400">
                  오늘 남은 발송량 {remaining}명 / {quota?.limit}명 (24시간 기준, 받은 메일 답장
                  포함)
                </p>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              {locked && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p>
                    결과를 확인하지 못해 입력을 잠갔습니다. 같은 요청으로 다시 시도해도 중복
                    발송되지 않습니다. 내용을 바꿔 보내려면 먼저 보낸 편지함에서 이미 나갔는지
                    확인해 주세요.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setStep('confirm')
                      }}
                      className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
                    >
                      같은 내용으로 다시 시도
                    </button>
                    <button
                      type="button"
                      onClick={startOver}
                      className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100"
                    >
                      새로 쓰기
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 p-5">
              <button
                onClick={close}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={goConfirm}
                disabled={frozen || to.length === 0 || !subject.trim() || !bodyOk}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                다음
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4 p-5 text-sm">
              <p className="text-amber-800 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                보낸 메일은 취소할 수 없습니다. 받는 사람을 다시 한 번 확인해 주세요.
              </p>
              {lists.map(list => (
                <div key={list.label}>
                  <div className="text-xs font-medium text-gray-500">{list.label}</div>
                  <ul className="mt-1 space-y-0.5">
                    {list.values.map(address => (
                      <li key={address} className="flex items-center gap-2">
                        <span className="text-gray-900">{address}</span>
                        {isExternal(address) && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            외부
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div>
                <div className="text-xs font-medium text-gray-500">제목</div>
                <div className="mt-1 text-gray-900">{validated.ok && validated.value.subject}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500">본문</div>
                <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-sans text-gray-800">
                  {body}
                </pre>
              </div>
              {forwardPicked.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500">
                    전달하는 원본 첨부 {forwardPicked.length}개
                  </div>
                  <ul className="mt-1 space-y-0.5 text-gray-800">
                    {forwardPicked.map(att => (
                      <li key={att.id}>
                        {att.filename}{' '}
                        <span className="text-gray-400">({formatBytes(att.size_bytes)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {files.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500">첨부 {files.length}개</div>
                  <ul className="mt-1 space-y-0.5 text-gray-800">
                    {files.map((file, i) => (
                      <li key={`${file.name}-${i}`}>
                        {file.name}{' '}
                        <span className="text-gray-400">({formatBytes(file.size)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 p-5">
              <button
                onClick={() => setStep('edit')}
                disabled={sending}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                수정
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? '보내는 중...' : `${count}명에게 보내기`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
