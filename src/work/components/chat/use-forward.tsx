'use client'

import { useCallback, useState, type ReactNode } from 'react'
import type { ChatMessage } from '@work/lib/messages/types'
import ForwardDialog, { ForwardNotice, type ForwardDone } from './ForwardDialog'

/**
 * 전달 대화상자 + 결과 안내를 한 곳에서 쥐는 훅. 채널 화면과 스레드 패널이 각자 하나씩 쓴다
 * (메시지마다 대화상자를 두지 않는다). `forward(message)` 로 열고, `dialog`·`notice` 를 화면에 그린다.
 */
export function useForward({
  sourceKind,
  nameOf,
}: {
  sourceKind: string
  nameOf: (userId: string | null) => string
}): { forward: (message: ChatMessage) => void; dialog: ReactNode; notice: ReactNode } {
  const [target, setTarget] = useState<ChatMessage | null>(null)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<ForwardDone | null>(null)

  const forward = useCallback((message: ChatMessage) => {
    setDone(null)
    setTarget(message)
    setOpen(true)
  }, [])

  return {
    forward,
    dialog: (
      <ForwardDialog
        open={open}
        onOpenChange={setOpen}
        message={target}
        sourceKind={sourceKind}
        authorName={target ? nameOf(target.author_id) : ''}
        onDone={setDone}
      />
    ),
    notice: done ? <ForwardNotice done={done} onDismiss={() => setDone(null)} /> : null,
  }
}
