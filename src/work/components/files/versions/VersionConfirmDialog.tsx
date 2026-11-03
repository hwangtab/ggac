'use client'

import type { ReactNode } from 'react'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'

/**
 * 버전 흐름의 확인 대화상자 공용 틀 — 수정 중 확인("김OO님이 10:32부터 수정 중입니다. 그래도 받을까요?")과
 * 저장 충돌("다른 사람이 먼저 v4를 저장했습니다 … [최신본 보기] [그래도 내 파일을 v5로 저장]")이 쓴다.
 * `extra` 는 취소 옆에 놓는 보조 동작(예: 최신본 보기 링크).
 */
export default function VersionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '취소',
  pending = false,
  extra,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  pending?: boolean
  extra?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={next => !next && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </Button>
          {extra}
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? '처리 중…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
