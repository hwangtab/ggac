'use client'

import { Field, FieldLabel } from '@work/components/ui/field'
import { useId, useRef, useState } from 'react'
import { MoreHorizontalIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { Input } from '@work/components/ui/input'
import { CATEGORY_NAME_MAX } from '@work/lib/channels/sections'
import { cn } from '@work/lib/utils'

/**
 * 카테고리 이름 입력 대화상자 — "새 카테고리"와 "이름 바꾸기"가 함께 쓴다.
 * onSubmit 은 실패 문구(없으면 성공)를 돌려주고, 성공이면 닫는다.
 */
export function CategoryNameDialog({
  open,
  title,
  description,
  initialName = '',
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  initialName?: string
  submitLabel: string
  onSubmit: (name: string) => Promise<string | null>
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        {open && (
          <NameForm
            title={title}
            description={description}
            initialName={initialName}
            submitLabel={submitLabel}
            onSubmit={onSubmit}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  title,
  description,
  initialName,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string
  description?: string
  initialName: string
  submitLabel: string
  onSubmit: (name: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const uid = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setPending(true)
    setError(null)
    const err = await onSubmit(trimmed)
    setPending(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description ?? '사이드바에 보이는 이름입니다.'}</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={`${uid}-name`}>카테고리 이름</FieldLabel>
        <Input
          id={`${uid}-name`}
          value={name}
          maxLength={CATEGORY_NAME_MAX}
          autoFocus
          required
          onChange={e => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-err` : undefined}
        />
        {error && (
          <p id={`${uid}-err`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * 카테고리 머리글 ⋯ 메뉴(관리자) — 이름 바꾸기 · 위로 · 아래로 · 삭제. 끌어다 놓기의 키보드·모바일 대체 경로이기도 하다.
 * 순수 컴포넌트: 실제 저장은 콜백이 한다. 삭제는 확인을 받고, 안의 채널은 "기타"로 간다는 걸 알린다.
 */
export default function CategoryMenu({
  name,
  channelCount,
  canMoveUp,
  canMoveDown,
  onRename,
  onMove,
  onDelete,
  className,
}: {
  name: string
  channelCount: number
  canMoveUp: boolean
  canMoveDown: boolean
  onRename: (name: string) => Promise<string | null>
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => Promise<string | null>
  className?: string
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={`${name} 카테고리 메뉴`}
          className={cn(
            'flex size-6 items-center justify-center rounded-w-md text-sidebar-foreground/70 outline-none hover:bg-sidebar-border hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:size-11',
            className
          )}
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>이름 바꾸기</DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove('up')}>
            위로 이동
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove('down')}>
            아래로 이동
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setDeleteError(null)
              setDeleteOpen(true)
            }}
          >
            삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CategoryNameDialog
        open={renameOpen}
        title="카테고리 이름 바꾸기"
        initialName={name}
        submitLabel="바꾸기"
        onSubmit={onRename}
        onClose={() => setRenameOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={`'${name}' 카테고리를 지울까요?`}
        description={
          <>
            {channelCount > 0
              ? `안에 있는 채널 ${channelCount}개는 지워지지 않고 "기타"로 옮겨집니다.`
              : '비어 있는 카테고리입니다.'}
            {deleteError && (
              <span role="alert" className="mt-2 block text-destructive">
                {deleteError}
              </span>
            )}
          </>
        }
        confirmLabel="삭제"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={async () => {
          const err = await onDelete()
          if (err) setDeleteError(err)
          else setDeleteOpen(false)
        }}
      />
    </>
  )
}
