'use client'

import { useSyncExternalStore } from 'react'
import { PencilIcon } from 'lucide-work'
import { useShellData } from '@work/components/layout/shell-context'
import { DRAFT_EVENT, draftChannelIds } from '@work/lib/messages/drafts'

/**
 * 임시 저장이 있는 대화 표시(연필) — 사이드바·채팅 목록 항목 안에 들어간다.
 * 저장소(localStorage)는 이 기기 것이므로 서버가 모른다 → 클라이언트에서 구독한다.
 * 스냅숏은 문자열(정렬한 id 목록)이라 내용이 같으면 재렌더하지 않는다.
 */
let cache: { version: number; userId: string; value: string } | null = null
let version = 0

function snapshotFor(userId: string): string {
  if (!cache || cache.version !== version || cache.userId !== userId) {
    cache = { version, userId, value: [...draftChannelIds(userId)].sort().join(',') }
  }
  return cache.value
}

function subscribe(onChange: () => void): () => void {
  const bump = () => {
    version++
    onChange()
  }
  window.addEventListener(DRAFT_EVENT, bump)
  window.addEventListener('storage', bump) // 다른 탭에서 바꾼 임시 저장
  return () => {
    window.removeEventListener(DRAFT_EVENT, bump)
    window.removeEventListener('storage', bump)
  }
}

export default function DraftMark({ channelId }: { channelId: string }) {
  const { meId } = useShellData()
  const ids = useSyncExternalStore(
    subscribe,
    () => (meId ? snapshotFor(meId) : ''),
    () => ''
  )
  if (!ids || !ids.split(',').includes(channelId.toLowerCase())) return null
  return (
    <>
      <PencilIcon
        aria-hidden="true"
        data-draft="true"
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="sr-only">(임시 저장된 글 있음)</span>
    </>
  )
}
