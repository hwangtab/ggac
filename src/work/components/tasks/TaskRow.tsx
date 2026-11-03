'use client'

import { chatLabelWithName } from '@work/lib/channels/group'
import { useId, useState, type FormEvent } from 'react'
import Link from '@work/lib/nav/link'
import { MessageSquareIcon, PencilIcon, Trash2Icon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { NativeSelect } from '@work/components/ui/native-select'
import { Input } from '@work/components/ui/input'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import { canDeleteTask, canEditTask } from '@work/lib/tasks/permissions'
import { dueLabel, dueState } from '@work/lib/tasks/due'
import { taskMessageHref } from '@work/lib/tasks/reducer'
import { TITLE_MAX } from '@work/lib/tasks/schema'
import type { TaskItem, TaskStaffOption } from '@work/lib/tasks/types'
import { cn } from '@work/lib/utils'

export type TaskRowProps = {
  task: TaskItem
  me: string
  isAdmin: boolean
  /** 내가 owner 인 채널 id(수정 권한 표시용) */
  ownedChannelIds?: readonly string[]
  /** 읽기 전용 화면(보관 채널 탭) — 체크·고치기·삭제를 숨기거나 막는다 */
  readOnly?: boolean
  today: string
  /** 활성 staff 전원 */
  staff: TaskStaffOption[]
  /** 이 할 일의 담당자 후보(그 채널을 읽을 수 있는 staff). 없으면 staff 전원 */
  candidatesFor?: (task: TaskItem) => TaskStaffOption[]
  /** 채널 이름을 함께 보일지("내 할 일" 탭) */
  showChannel?: boolean
  onToggle: (task: TaskItem, done: boolean) => void
  onSave: (
    task: TaskItem,
    patch: { title: string; assigneeId: string | null; dueOn: string | null }
  ) => Promise<boolean>
  onDelete: (task: TaskItem) => void
}

function EditForm({
  task,
  staff,
  candidates,
  onCancel,
  onSave,
}: {
  task: TaskItem
  staff: TaskStaffOption[]
  candidates: TaskStaffOption[]
  onCancel: () => void
  onSave: TaskRowProps['onSave']
}) {
  const uid = useId()
  const [title, setTitle] = useState(task.title)
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? '')
  const [dueOn, setDueOn] = useState(task.due_on ?? '')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving || !title.trim()) return
    setSaving(true)
    const done = await onSave(task, {
      title,
      assigneeId: assigneeId || null,
      dueOn: dueOn || null,
    })
    setSaving(false)
    if (done) onCancel()
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key === 'Escape') onCancel()
      }}
      aria-label={`${task.title} 고치기`}
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
    >
      <Input
        id={`${uid}-t`}
        aria-label="할 일 제목"
        value={title}
        maxLength={TITLE_MAX}
        autoFocus
        onChange={e => setTitle(e.target.value)}
        className="sm:col-span-3"
      />
      <NativeSelect
        id={`${uid}-a`}
        aria-label="할 일 담당자"
        value={assigneeId}
        onChange={e => setAssigneeId(e.target.value)}
      >
        <option value="">담당자 없음</option>
        {/* 비활성(퇴사)·채널 밖 담당자는 후보 목록에 없다 — 현재 값이 사라 보이지 않게 따로 보여 준다. */}
        {task.assignee_id && !candidates.some(s => s.user_id === task.assignee_id) && (
          <option value={task.assignee_id}>
            {task.assignee_name ?? '(알 수 없음)'}{' '}
            {staff.some(s => s.user_id === task.assignee_id) ? '(채널 밖)' : '(비활성)'}
          </option>
        )}
        {candidates.map(s => (
          <option key={s.user_id} value={s.user_id}>
            {s.display_name}
          </option>
        ))}
      </NativeSelect>
      <Input
        id={`${uid}-d`}
        aria-label="할 일 마감일"
        type="date"
        value={dueOn}
        onChange={e => setDueOn(e.target.value)}
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="xs" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" size="xs" disabled={saving || !title.trim()}>
          저장
        </Button>
      </div>
    </form>
  )
}

export default function TaskRow({
  task,
  me,
  isAdmin,
  ownedChannelIds,
  readOnly = false,
  today,
  staff,
  candidatesFor,
  showChannel = true,
  onToggle,
  onSave,
  onDelete,
}: TaskRowProps) {
  const [editing, setEditing] = useState(false)
  const done = task.status === 'done'
  const state = dueState(task.due_on, done, today)
  const href = taskMessageHref(task)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const canEdit = canEditTask(task, { me, isAdmin, ownedChannelIds, readOnly })
  const canDelete = canDeleteTask(task, { me, isAdmin, readOnly })

  return (
    <li className="flex min-h-10 items-start gap-3 px-4 py-3">
      {/* 터치 기기에서는 체크박스(16px)를 44px 눌림 영역 label 로 감싼다 — 음수 여백이라 행 높이는 그대로 */}
      <label className="mt-0.5 flex size-4 shrink-0 items-center justify-center pointer-coarse:-m-3 pointer-coarse:size-11">
        <input
          type="checkbox"
          checked={done}
          disabled={!canEdit}
          onChange={e => onToggle(task, e.target.checked)}
          aria-label={`${task.title} 완료`}
          className="size-4 accent-[var(--primary)]"
        />
      </label>
      <div className="min-w-0 flex-1">
        {editing ? (
          <EditForm
            task={task}
            staff={staff}
            candidates={candidatesFor ? candidatesFor(task) : staff}
            onCancel={() => setEditing(false)}
            onSave={onSave}
          />
        ) : (
          <>
            <p
              className={cn(
                'text-sm leading-5 break-words',
                done && 'text-muted-foreground line-through'
              )}
            >
              {task.title}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {showChannel && (
                <span>
                  {task.channel_kind === 'dm'
                    ? (task.chat_label ?? chatLabelWithName(task.channel_name))
                    : `#${task.channel_name}`}
                </span>
              )}
              <span>{task.assignee_name ? `담당 ${task.assignee_name}` : '담당자 없음'}</span>
              {task.due_on && (
                <span
                  className={cn(
                    state === 'overdue' && 'font-semibold text-destructive',
                    (state === 'today' || state === 'soon') && 'font-semibold text-primary'
                  )}
                >
                  마감 {dueLabel(task.due_on, today)}
                  {state === 'overdue' && ' (기한 지남)'}
                </span>
              )}
              {href && (
                <Link
                  href={href}
                  aria-label={`${task.title} 원본 메시지`}
                  className="inline-flex items-center gap-1 rounded text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MessageSquareIcon aria-hidden="true" className="size-3.5" />
                  원본 메시지
                </Link>
              )}
            </p>
          </>
        )}
      </div>
      {!editing && (canEdit || canDelete) && (
        <div className="flex shrink-0 items-center gap-0.5">
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${task.title} 고치기`}
              onClick={() => setEditing(true)}
            >
              <PencilIcon aria-hidden="true" />
            </Button>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${task.title} 삭제`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="이 할 일을 삭제할까요?"
        description={`"${task.title}" 할 일이 목록에서 사라집니다. 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete(task)
        }}
      />
    </li>
  )
}
