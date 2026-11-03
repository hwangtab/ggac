'use client'

import { useState } from 'react'
import { Button } from '@work/components/ui/button'
import StatusDialog from '@work/components/notifications/StatusDialog'
import { statusLine, type ActiveStatus } from '@work/lib/notifications/status'

/**
 * 업무 설정의 상태 메시지 — ggac에서 더한 부품(docs/board-work/03-통합-재설계.md §2-3). 원본은 상단바 계정 메뉴에서
 * StatusDialog를 열었다. 상단바가 없어져 여기서 연다. 저장하면 서버 액션이 경로를 다시 그려 지금 값이 바뀐다.
 */
export default function StatusSetting({ current }: { current: ActiveStatus | null }) {
  const [open, setOpen] = useState(false)
  const line = statusLine(current)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-sm" data-testid="board-work-status-line">
        {line || <span className="text-muted-foreground">상태 메시지가 없습니다</span>}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {line ? '상태 메시지 바꾸기' : '상태 메시지 설정'}
      </Button>
      <StatusDialog
        key={open ? 'open' : 'closed'}
        open={open}
        onOpenChange={setOpen}
        current={current}
      />
    </div>
  )
}
