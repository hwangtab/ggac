'use client'

import { Field, FieldLabel, FieldHint } from '@work/components/ui/field'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import { HashIcon, LockIcon, UserIcon, UsersIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import { Textarea } from '@work/components/ui/textarea'
import {
  filterForwardTargets,
  FORWARD_COMMENT_MAX_CHARS,
  needsForwardConfirm,
  type ForwardTarget,
} from '@work/lib/messages/forward'
import { forwardMessage, listForwardTargets } from '@work/lib/messages/forward-actions'
import { quotePreviewLines } from '@work/lib/messages/quote'
import type { ChatMessage } from '@work/lib/messages/types'
import { cn } from '@work/lib/utils'

export type ForwardDone = {
  href: string
  targetName: string
  attachmentsCopied: number
  attachmentsLinkOnly: boolean
  attachmentsFailed: number
}

/**
 * 전달 대화상자(0028): 대화 선택(검색) → 선택 코멘트 → 전달.
 * 원본이 비공개 채널·DM·그룹이면 한 번 더 확인한다("원래 대화에 없는 사람도 보게 됩니다").
 * 서버(forwardMessage)가 같은 확인을 강제한다 — 이 화면은 안내일 뿐이다.
 */
export default function ForwardDialog({
  open,
  onOpenChange,
  message,
  sourceKind,
  authorName,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: ChatMessage | null
  /** 원본 대화 종류 — 비공개(private·dm)면 확인 단계를 둔다 */
  sourceKind: string
  authorName: string
  onDone: (done: ForwardDone) => void
}) {
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 같은 시도의 재전송·더블클릭이 두 번 전달되지 않게 하는 멱등 키(열 때·대상을 바꿀 때 새로 만든다)
  const attemptId = useRef<string>(crypto.randomUUID())
  useEffect(() => {
    attemptId.current = crypto.randomUUID()
  }, [open, selectedId])
  const searchId = useId()
  const commentId = useId()

  // 열 때마다 처음 상태로 + 대상 목록을 새로 읽는다(채널 참여·공지 설정이 바뀌었을 수 있다)
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedId(null)
    setComment('')
    setStep('pick')
    setError(null)
    setLoadError(null)
    setTargets(null)
    let cancelled = false
    listForwardTargets()
      .then(res => {
        if (cancelled) return
        if (res.ok) setTargets(res.data)
        else setLoadError(res.error)
      })
      .catch(() => {
        if (!cancelled) setLoadError('대화 목록을 불러오지 못했습니다.')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const shown = useMemo(() => filterForwardTargets(targets ?? [], query), [targets, query])
  const selected = targets?.find(t => t.id === selectedId) ?? null
  const preview = message ? quotePreviewLines(message.body) : { lines: [], truncated: false }
  const confirmNeeded = needsForwardConfirm(sourceKind)

  const submit = useCallback(async () => {
    if (!message || !selected || pending) return
    setPending(true)
    setError(null)
    try {
      const res = await forwardMessage({
        messageId: message.id,
        targetChannelId: selected.id,
        comment: comment.trim() || undefined,
        confirmed: confirmNeeded ? true : undefined,
        id: attemptId.current,
      })
      if (!res.ok) {
        setError(res.error)
        setStep('pick')
        return
      }
      onDone({
        href: res.data.href,
        targetName: selected.name,
        attachmentsCopied: res.data.attachmentsCopied,
        attachmentsLinkOnly: res.data.attachmentsLinkOnly,
        attachmentsFailed: res.data.attachmentsFailed,
      })
      onOpenChange(false)
    } catch (e) {
      console.error('[forward]', e)
      setError('네트워크 오류로 전달하지 못했습니다.')
      setStep('pick')
    } finally {
      setPending(false)
    }
  }, [message, selected, pending, comment, confirmNeeded, onDone, onOpenChange])

  function next() {
    if (!selected) return
    if (confirmNeeded) setStep('confirm')
    else void submit()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>메시지 전달</DialogTitle>
          <DialogDescription>
            {step === 'confirm'
              ? '비공개 대화의 메시지를 전달합니다.'
              : `${authorName}의 메시지를 보낼 대화를 고릅니다.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'confirm' ? (
          <div className="space-y-2 text-sm">
            <p role="alert" className="rounded-w-md bg-muted px-3 py-2">
              원래 대화에 없는 사람도 보게 됩니다. 전달하면 원문이 <strong>{selected?.name}</strong>
              에 복사됩니다.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <blockquote className="min-w-0 overflow-hidden rounded-w-md border-l-2 border-primary bg-muted/50 px-3 py-1.5 text-xs">
              <span className="block font-semibold">{authorName}</span>
              {preview.lines.length > 0 ? (
                preview.lines.map((l, i) => (
                  <span key={i} className="block truncate text-muted-foreground">
                    {l}
                    {preview.truncated && i === preview.lines.length - 1 ? '…' : ''}
                  </span>
                ))
              ) : (
                <span className="block text-muted-foreground">(첨부 메시지)</span>
              )}
              {message && message.attachments_count > 0 && (
                <span className="block text-muted-foreground">
                  첨부 {message.attachments_count}개
                </span>
              )}
            </blockquote>

            <Field>
              <FieldLabel htmlFor={searchId}>보낼 대화</FieldLabel>
              <Input
                id={searchId}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="채널·사람 이름 검색"
                autoComplete="off"
              />
              <TargetList
                targets={targets}
                shown={shown}
                loadError={loadError}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={commentId}>
                코멘트 <FieldHint>(선택)</FieldHint>
              </FieldLabel>
              <Textarea
                id={commentId}
                value={comment}
                rows={2}
                maxLength={FORWARD_COMMENT_MAX_CHARS}
                onChange={e => setComment(e.target.value)}
                placeholder="전달과 함께 남길 말"
                className="block [field-sizing:fixed] min-h-0 resize-y rounded-w-md bg-background px-2 py-1.5"
              />
            </Field>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          {step === 'confirm' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('pick')}>
                돌아가기
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={pending}>
                {pending ? '전달하는 중…' : '전달'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="button" onClick={next} disabled={!selected || pending}>
                {pending ? '전달하는 중…' : '전달'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TargetList({
  targets,
  shown,
  loadError,
  selectedId,
  onSelect,
}: {
  targets: ForwardTarget[] | null
  shown: ForwardTarget[]
  loadError: string | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (loadError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {loadError}
      </p>
    )
  }
  if (!targets) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        대화 목록을 불러오는 중…
      </p>
    )
  }
  if (shown.length === 0) {
    return <p className="text-xs text-muted-foreground">맞는 대화가 없습니다.</p>
  }
  return (
    <ul
      aria-label="보낼 대화"
      className="max-h-52 space-y-px overflow-y-auto rounded-w-md border p-1"
    >
      {shown.map(t => {
        const Icon: (p: { className?: string; 'aria-hidden'?: 'true' }) => ReactNode =
          t.kind === 'dm'
            ? t.group
              ? UsersIcon
              : UserIcon
            : t.kind === 'private'
              ? LockIcon
              : HashIcon
        const selected = t.id === selectedId
        return (
          <li key={t.id}>
            <button
              type="button"
              aria-pressed={selected}
              disabled={t.restricted}
              onClick={() => onSelect(t.id)}
              className={cn(
                'flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                selected && 'bg-primary/10 font-medium text-primary'
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.kind === 'private' && <span className="sr-only">(비공개)</span>}
              {t.group && <span className="sr-only">(그룹 채팅)</span>}
              {t.restricted && (
                <span className="shrink-0 text-xs text-muted-foreground">소유자만 글쓰기</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** 전달 결과 안내 한 줄(대화 링크 포함) */
export function ForwardNotice({ done, onDismiss }: { done: ForwardDone; onDismiss: () => void }) {
  const extra = [
    done.attachmentsLinkOnly ? '첨부가 많거나 커서 원문 링크만 전달했습니다.' : null,
    done.attachmentsFailed > 0 ? `첨부 ${done.attachmentsFailed}개는 복제하지 못했습니다.` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <p
      role="status"
      className="mx-4 mb-1 flex flex-wrap items-center gap-x-2 rounded-w-md bg-muted px-3 py-1.5 text-xs"
    >
      <span>{done.targetName}에 전달했습니다.</span>
      <Link href={done.href} className="font-medium text-primary hover:underline">
        열기
      </Link>
      {extra && <span className="text-muted-foreground">{extra}</span>}
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto text-muted-foreground hover:underline"
      >
        닫기
      </button>
    </p>
  )
}
