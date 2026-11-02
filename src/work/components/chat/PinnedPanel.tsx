'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-work'
import { loadPinnedMessages } from '@work/lib/messages/actions'
import type { ChatMessage } from '@work/lib/messages/types'
import type { MentionMember } from './ChatMarkdown'
import MessageItem from './MessageItem'

/** 고정 메시지 목록(우측 패널). 열 때마다 서버에서 다시 읽는다 */
export default function PinnedPanel({
  channelId,
  me,
  nameOf,
  members,
  onUnpin,
}: {
  channelId: string
  me: string
  nameOf: (userId: string | null) => string
  members?: readonly MentionMember[]
  onUnpin?: (message: ChatMessage) => void
}) {
  const [items, setItems] = useState<ChatMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadPinnedMessages({ channelId }).then(res => {
      if (!alive) return
      if (res.ok) setItems(res.data)
      else setError(res.error)
    })
    return () => {
      alive = false
    }
  }, [channelId])

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (!items) {
    return (
      <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        불러오는 중…
      </p>
    )
  }
  if (items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">고정된 메시지가 없습니다.</p>
  }
  return (
    <div className="py-2">
      {items.map(m => (
        <MessageItem
          key={m.id}
          message={m}
          me={me}
          nameOf={nameOf}
          members={members}
          pinned
          onTogglePin={
            onUnpin
              ? msg => {
                  onUnpin(msg)
                  setItems(cur => cur?.filter(x => x.id !== msg.id) ?? null)
                }
              : undefined
          }
        />
      ))}
    </div>
  )
}
