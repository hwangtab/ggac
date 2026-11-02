'use client'

import { Field, FieldLabel, FieldChoice } from '@work/components/ui/field'
import { useId, useState, useTransition } from 'react'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import { saveNotificationPrefs } from '@work/lib/notifications/actions'
import {
  DIGEST_MODES,
  DIGEST_MODE_LABEL,
  minutesToTime,
  type DigestMode,
  type QuietPrefs,
} from '@work/lib/notifications/quiet-hours'

/**
 * 방해 금지(조용한 시간, Asia/Seoul) + 메일 다이제스트 설정. 푸시는 이 시간대에 가지 않는다(멘션 포함).
 * 저장은 서버 액션(saveNotificationPrefs) — 본인 행(work.staff_prefs)만 바뀐다.
 */
export default function NotificationPrefsForm({
  initialQuiet,
  initialDigestMode,
}: {
  initialQuiet: QuietPrefs
  initialDigestMode: DigestMode
}) {
  const uid = useId()
  const [enabled, setEnabled] = useState(initialQuiet.enabled)
  const [start, setStart] = useState(minutesToTime(initialQuiet.start))
  const [end, setEnd] = useState(minutesToTime(initialQuiet.end))
  const [weekends, setWeekends] = useState(initialQuiet.weekends)
  const [digestMode, setDigestMode] = useState<DigestMode>(initialDigestMode)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setMessage(null)
    startTransition(async () => {
      const res = await saveNotificationPrefs({
        quiet: { enabled, start, end, weekends },
        digestMode,
      })
      setMessage(
        res.ok ? { tone: 'ok', text: '저장했습니다.' } : { tone: 'error', text: res.error }
      )
    })
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-4 rounded-w-lg border p-4">
        <legend className="px-1 text-sm font-semibold">방해 금지 시간</legend>
        <p className="text-xs text-muted-foreground">
          정한 시간에는 푸시 알림을 보내지 않습니다(멘션 포함). 놓친 글은 앱에서 그대로 읽지
          않음으로 남습니다. 시각은 한국 시간(Asia/Seoul) 기준입니다.
        </p>
        <FieldChoice>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          방해 금지 사용
        </FieldChoice>
        <div className="flex flex-wrap items-end gap-3">
          <Field>
            <FieldLabel htmlFor={`${uid}-start`}>시작</FieldLabel>
            <Input
              id={`${uid}-start`}
              type="time"
              value={start}
              onChange={e => setStart(e.target.value)}
              disabled={!enabled}
              className="h-9 w-32"
            />
          </Field>
          <span aria-hidden="true" className="pb-2 text-muted-foreground">
            ~
          </span>
          <Field>
            <FieldLabel htmlFor={`${uid}-end`}>끝</FieldLabel>
            <Input
              id={`${uid}-end`}
              type="time"
              value={end}
              onChange={e => setEnd(e.target.value)}
              disabled={!enabled}
              className="h-9 w-32"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          시작이 끝보다 늦으면 자정을 넘기는 시간입니다(예: 22:00 ~ 08:00).
        </p>
        <FieldChoice>
          <input
            type="checkbox"
            checked={weekends}
            onChange={e => setWeekends(e.target.checked)}
            disabled={!enabled}
          />
          토요일·일요일은 하루 종일
        </FieldChoice>
      </fieldset>

      <fieldset className="space-y-4 rounded-w-lg border p-4">
        <legend className="px-1 text-sm font-semibold">메일 알림(다이제스트)</legend>
        <p className="text-xs text-muted-foreground">
          멘션이나 다이렉트 메시지를 오래 읽지 않으면 가입한 메일 주소로 한 통에 모아 보냅니다.
          알림을 끈 대화는 포함하지 않습니다. 기본은 메일을 받지 않으며, 원하면 여기서 켭니다.
        </p>
        <div className="flex flex-col gap-2">
          {DIGEST_MODES.map(mode => (
            <FieldChoice key={mode}>
              <input
                type="radio"
                name={`${uid}-digest`}
                value={mode}
                checked={digestMode === mode}
                onChange={() => setDigestMode(mode)}
              />
              {DIGEST_MODE_LABEL[mode]}
            </FieldChoice>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <p
          role="status"
          className={
            message?.tone === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {message?.text ?? ''}
        </p>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  )
}
