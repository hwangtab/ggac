'use client'

import { WifiOffIcon } from 'lucide-work'
import type { TopicStatus } from '@work/lib/messages/realtime'
import type { TypingUser } from './use-channel-topic'

/** 네트워크 끊김·실시간 재연결 배지. 연결돼 있으면 아무것도 그리지 않는다 */
export function ConnectionBadge({
  status,
  online,
}: {
  status: TopicStatus
  /** navigator.onLine */
  online: boolean
}) {
  if (online && (status === 'connected' || status === 'connecting')) return null
  const text = !online
    ? '네트워크 연결이 끊겼습니다. 다시 연결되면 새 메시지를 불러옵니다.'
    : '실시간 연결이 끊겼습니다. 다시 연결하는 중…'
  return (
    <div
      role="status"
      className="mx-4 mt-2 flex items-center gap-2 rounded-w-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
    >
      <WifiOffIcon aria-hidden="true" className="size-3.5" />
      {text}
    </div>
  )
}

/** "OO님이 입력 중…" — 입력창 바로 위 한 줄(높이 고정으로 레이아웃이 흔들리지 않게) */
export function TypingIndicator({ users }: { users: TypingUser[] }) {
  let text = ''
  if (users.length === 1) text = `${users[0].displayName}님이 입력 중…`
  else if (users.length === 2)
    text = `${users[0].displayName}님, ${users[1].displayName}님이 입력 중…`
  else if (users.length > 2) text = `${users.length}명이 입력 중…`
  return (
    <div aria-live="polite" className="h-5 truncate px-4 text-xs text-muted-foreground">
      {text}
    </div>
  )
}
