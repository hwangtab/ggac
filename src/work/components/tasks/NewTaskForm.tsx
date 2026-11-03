'use client'

import { Field, FieldLabel } from '@work/components/ui/field'
import { useId, useState, type FormEvent } from 'react'
import { PlusIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { NativeSelect } from '@work/components/ui/native-select'
import { Input } from '@work/components/ui/input'
import { cn } from '@work/lib/utils'
import { createTask } from '@work/lib/tasks/actions'
import type { NewTaskPrefill } from '@work/lib/tasks/schema'
import { TITLE_MAX } from '@work/lib/tasks/schema'
import type { TaskChannelOption, TaskItem, TaskStaffOption } from '@work/lib/tasks/types'

export default function NewTaskForm({
  channels,
  staff,
  candidatesFor,
  prefill,
  lockChannel = false,
  onCreated,
  onDismiss,
  triggerClassName,
}: {
  channels: TaskChannelOption[]
  staff: TaskStaffOption[]
  /** 채널별 담당자 후보(그 채널을 읽을 수 있는 staff). 없으면 staff 전원 */
  candidatesFor?: (channelId: string) => TaskStaffOption[]
  prefill: NewTaskPrefill | null
  /** 대화 "할 일" 탭: 채널 선택을 숨기고 첫(유일한) 채널로 고정한다 */
  lockChannel?: boolean
  onCreated: (task: TaskItem) => void
  /** 폼을 닫거나 만든 뒤 부른다 — URL 로 열린 폼이면 호출한 쪽이 `new` 파라미터를 지운다 */
  onDismiss?: () => void
  /** 닫힌 상태의 `+ 새 할 일` 버튼 클래스 — /tasks 넓은 화면은 목록 칸 머리글에 같은 버튼이 있어 `lg:hidden` 으로 숨긴다 */
  triggerClassName?: string
}) {
  const uid = useId()
  const [open, setOpen] = useState(prefill !== null)
  const initialChannel =
    prefill?.channelId && channels.some(c => c.id === prefill.channelId)
      ? prefill.channelId
      : (channels[0]?.id ?? '')
  const [channelId, setChannelId] = useState(initialChannel)
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueOn, setDueOn] = useState('')
  // 메시지에서 만드는 경우 채널을 바꾸면 원본 메시지 연결은 끊는다
  const [messageId, setMessageId] = useState(
    prefill?.messageId && initialChannel === prefill.channelId ? prefill.messageId : null
  )
  const [pending, setPending] = useState(false)
  const candidates = candidatesFor ? candidatesFor(channelId) : staff
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    let res: Awaited<ReturnType<typeof createTask>>
    try {
      res = await createTask({
        channelId,
        title,
        assigneeId: assigneeId || null,
        dueOn: dueOn || null,
        messageId,
      })
    } catch {
      // 서버 액션이 던지면(오프라인 등) 버튼이 영영 잠기지 않게 풀어 준다.
      setPending(false)
      setError('네트워크 문제로 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onCreated(res.data.task)
    setTitle('')
    setAssigneeId('')
    setDueOn('')
    setMessageId(null)
    if (prefill) {
      setOpen(false)
      onDismiss?.()
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn('self-start', triggerClassName)}
      >
        <PlusIcon aria-hidden="true" />새 할 일
      </Button>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={`${uid}-heading`}
      className="grid gap-3 rounded-w-lg border bg-card p-4 md:grid-cols-[1fr_1fr]"
    >
      <h2 id={`${uid}-heading`} className="text-sm font-semibold md:col-span-2">
        새 할 일{messageId ? ' (메시지에서 만드는 중)' : ''}
      </h2>

      <Field className="md:col-span-2">
        <FieldLabel htmlFor={`${uid}-title`}>제목</FieldLabel>
        <Input
          id={`${uid}-title`}
          value={title}
          maxLength={TITLE_MAX}
          required
          onChange={e => setTitle(e.target.value)}
          className="h-9"
        />
      </Field>

      {!lockChannel && (
        <Field>
          <FieldLabel htmlFor={`${uid}-channel`}>채널</FieldLabel>
          <NativeSelect
            id={`${uid}-channel`}
            value={channelId}
            required
            onChange={e => {
              setChannelId(e.target.value)
              // 바꾼 채널을 못 보는 담당자는 비운다
              if (
                assigneeId &&
                candidatesFor &&
                !candidatesFor(e.target.value).some(s => s.user_id === assigneeId)
              ) {
                setAssigneeId('')
              }
              if (prefill?.messageId && e.target.value === prefill.channelId) {
                setMessageId(prefill.messageId)
              } else {
                setMessageId(null)
              }
            }}
          >
            {channels.map(c => (
              <option key={c.id} value={c.id}>
                {c.kind === 'dm'
                  ? `${c.group ? '그룹 채팅' : '다이렉트 메시지'} · ${c.name}`
                  : `# ${c.name}`}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor={`${uid}-assignee`}>담당자</FieldLabel>
        <NativeSelect
          id={`${uid}-assignee`}
          value={assigneeId}
          onChange={e => setAssigneeId(e.target.value)}
        >
          <option value="">담당자 없음</option>
          {candidates.map(s => (
            <option key={s.user_id} value={s.user_id}>
              {s.display_name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor={`${uid}-due`}>마감일</FieldLabel>
        <Input
          id={`${uid}-due`}
          type="date"
          value={dueOn}
          onChange={e => setDueOn(e.target.value)}
          className="h-9"
        />
      </Field>

      <div className="flex items-end justify-end gap-2 md:col-span-2">
        {error && (
          <p role="alert" className="mr-auto text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false)
            onDismiss?.()
          }}
        >
          닫기
        </Button>
        <Button type="submit" size="sm" disabled={pending || !title.trim() || !channelId}>
          만들기
        </Button>
      </div>
    </form>
  )
}
