'use client'

import { useEffect, useState } from 'react'
import { subscribeWorkspacePresence } from '@work/lib/messages/realtime'

const NONE: ReadonlySet<string> = new Set()

/**
 * 워크스페이스 전역 presence(0020) — 셸에서 한 번 구독해 접속 중인 사용자 id 집합을 돌려준다.
 * `me` 가 null 이면(게스트·미확인) 구독하지 않고 빈 집합이다: 게스트에게 전 직원 접속 상태를 노출하지 않는다.
 * 탭이 백그라운드여도 연결은 supabase 기본에 맡기고, 언마운트하면 untrack 한다(허브가 처리).
 */
export function useWorkspacePresence(
  me: { userId: string; displayName: string } | null
): ReadonlySet<string> {
  const [online, setOnline] = useState<ReadonlySet<string>>(NONE)
  const userId = me?.userId ?? null
  const displayName = me?.displayName ?? ''

  useEffect(() => {
    if (!userId) return
    const handle = subscribeWorkspacePresence(
      event => {
        if (event.type === 'presence') setOnline(new Set(event.userIds))
      },
      { track: { user_id: userId, display_name: displayName } }
    )
    setOnline(new Set(handle.getOnline()))
    return () => {
      handle.unsubscribe()
      setOnline(NONE)
    }
  }, [userId, displayName])

  return userId ? online : NONE
}
