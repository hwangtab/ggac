'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { useSidebarBadges } from '@work/components/layout/sidebar-badges'
import type { ChannelListItem } from '@work/components/layout/channel-items'
import type { SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'
import { subscribeBadges, subscribeUserTopic } from '@work/lib/messages/realtime'
import { channelsWithNewActivity } from '@work/lib/sync/poll'

/** 새 채널·DM 신호 — 첫 DM 은 빨리 보여야 하므로 짧게 묶는다(원본과 같다) */
const USER_REFRESH_DEBOUNCE_MS = 300

/**
 * 사이드바 실시간 갱신(화면에 아무것도 그리지 않는다) — ggac 이식: **폴링 응답을 받아 쓴다**(02-sync.md §5).
 *
 * 원본은 내가 멤버인 채널 토픽을 모두 구독해, 배지가 바뀔 만한 신호가 오면 getSidebarBadges(RPC 3개)를 불렀다.
 * 폴링은 응답마다 같은 모양의 배지(`badges`)를 실어 주므로 채널마다 구독하지 않고 그 값을 셸에 그대로 맞춘다
 * (`applySnapshot` — router.refresh() 없이 숫자만). 안 읽은 수가 늘어난 채널은 최근 활동순 목록에서 위로 올린다.
 *
 * 아직 사이드바에 없는 채널(처음 받은 DM·채널 초대)은 사용자 단위 변경 번호(`membershipChanged`)로 안다 —
 * 사용자 토픽의 `MEMBER_ADDED` 신호를 받으면 서버 렌더로 목록을 새로 그린다(원본과 같은 경로).
 */
export default function SidebarLiveUpdates({
  items,
  me,
}: {
  items: Pick<ChannelListItem, 'id' | 'slug' | 'kind' | 'name' | 'unread' | 'starred' | 'muted'>[]
  me: string
}) {
  const router = useRouter()
  const badges = useSidebarBadges()
  const badgesRef = useRef(badges)
  badgesRef.current = badges
  // 셸 데이터가 새로 오면(router.refresh) 비교 기준도 버린다 — 새 목록 기준으로 다시 센다
  const lastRef = useRef<SidebarBadgeSnapshot | null>(null)
  const lastJsonRef = useRef('')
  const ids = items
    .map(i => i.id)
    .sort()
    .join(',')

  useEffect(() => {
    lastRef.current = null
    lastJsonRef.current = ''
    return subscribeBadges((snapshot, requestedAt) => {
      const api = badgesRef.current
      if (!api) return // 셸 밖(테스트·단독 렌더) — 배지를 그릴 곳이 없다
      // 폴마다(3초) 셸 전체를 다시 그리지 않게 — 숫자가 그대로면 넘긴다. 앞서 적용한 스냅샷 시각이 남아
      // 그 뒤의 읽음 기록은 계속 얹힌다(effectiveReads)
      const json = JSON.stringify(snapshot)
      if (json === lastJsonRef.current) return
      lastJsonRef.current = json
      api.applySnapshot(snapshot, requestedAt)
      const now = Date.now()
      for (const id of channelsWithNewActivity(lastRef.current, snapshot)) {
        api.bumpActivity(id, now)
      }
      lastRef.current = snapshot
    })
  }, [ids])

  useEffect(() => {
    if (!me) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const refreshSoon = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        router.refresh()
      }, USER_REFRESH_DEBOUNCE_MS)
    }
    const handle = subscribeUserTopic(me, event => {
      if (event.type === 'user') refreshSoon()
    })
    return () => {
      if (timer) clearTimeout(timer)
      handle.unsubscribe()
    }
  }, [me, router])

  return null
}
