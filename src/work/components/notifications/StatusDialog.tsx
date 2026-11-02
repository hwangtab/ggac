'use client'

import { Field, FieldLabel, FieldDescription } from '@work/components/ui/field'
import { useId, useState, useTransition } from 'react'
import { Button } from '@work/components/ui/button'
import { NativeSelect } from '@work/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import { clearMyStatus, setMyStatus } from '@work/lib/notifications/actions'
import {
  STATUS_EXPIRY_LABEL,
  STATUS_EXPIRY_OPTIONS,
  STATUS_EXPIRY_KEEP,
  STATUS_PRESETS,
  STATUS_TEXT_MAX,
  type ActiveStatus,
  initialStatusExpiry,
  keepExpiryLabel,
  type StatusExpiryChoice,
} from '@work/lib/notifications/status'

const QUICK_EMOJI = ['💬', '📅', '🍚', '🚗', '🌴', '🏠', '🤒', '🎧'] as const

/**
 * 상태 메시지 설정(이모지 + 최대 80자 + 만료). 프로필 메뉴에서 연다.
 * 저장하면 동료의 DM 목록·멤버 목록·작성자 툴팁·멘션 자동완성에 보인다(게스트에게는 같은 대화의 사람만).
 */
export default function StatusDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: ActiveStatus | null
}) {
  const uid = useId()
  const [emoji, setEmoji] = useState(current?.emoji ?? '')
  const [text, setText] = useState(current?.text ?? '')
  const [expiry, setExpiry] = useState<StatusExpiryChoice>(() => initialStatusExpiry(current))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (res.ok) onOpenChange(false)
      else setError(res.error ?? '저장하지 못했습니다.')
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>상태 메시지</DialogTitle>
          <DialogDescription>
            동료에게 지금 상황을 알립니다. 정한 시간이 지나면 저절로 사라집니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="자주 쓰는 상태">
          {STATUS_PRESETS.map(p => (
            <Button
              key={p.text}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEmoji(p.emoji)
                setText(p.text)
                setExpiry(p.expiry)
              }}
            >
              <span aria-hidden="true">{p.emoji}</span> {p.text}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`${uid}-emoji`}>이모지</FieldLabel>
            <div className="flex flex-wrap items-center gap-1">
              <Input
                id={`${uid}-emoji`}
                value={emoji}
                onChange={e => setEmoji(e.target.value)}
                placeholder="😀"
                maxLength={16}
                className="w-20 text-center"
              />
              {QUICK_EMOJI.map(e => (
                <Button
                  key={e}
                  type="button"
                  size="icon-sm"
                  variant={emoji === e ? 'secondary' : 'ghost'}
                  aria-label={`이모지 ${e}`}
                  aria-pressed={emoji === e}
                  onClick={() => setEmoji(e)}
                >
                  <span aria-hidden="true">{e}</span>
                </Button>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-text`}>상태 문구</FieldLabel>
            <Input
              id={`${uid}-text`}
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={STATUS_TEXT_MAX}
              placeholder="예: 회의 중"
            />
            <FieldDescription>
              {Array.from(text).length} / {STATUS_TEXT_MAX}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-expiry`}>지우는 시점</FieldLabel>
            <NativeSelect
              id={`${uid}-expiry`}
              value={expiry}
              onChange={e => setExpiry(e.target.value as StatusExpiryChoice)}
            >
              {current?.until && (
                <option value={STATUS_EXPIRY_KEEP}>{keepExpiryLabel(current.until)}</option>
              )}
              {STATUS_EXPIRY_OPTIONS.map(o => (
                <option key={o} value={o}>
                  {STATUS_EXPIRY_LABEL[o]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          {current && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => clearMyStatus())}
            >
              상태 지우기
            </Button>
          )}
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(() => setMyStatus({ emoji, text, expiry }))}
          >
            {pending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
