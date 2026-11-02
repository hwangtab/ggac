'use client'

import { createContext, useContext } from 'react'
import type { SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'
import type { ChannelListItem } from './channel-items'

/**
 * 사이드바 배지(안 읽은 수·멘션 수)를 서버 재조회 없이 클라이언트에서 바로 맞추는 통로.
 * 채널 화면이 읽음 처리(markChannelRead)를 끝내면 그 채널 배지를 지우고 "받은 멘션" 수를 줄인다 —
 * router.refresh() 로 레이아웃·페이지를 통째로 다시 조회하지 않기 위해서다.
 * 서버가 새 사이드바 데이터를 보내오면(실시간 갱신·다른 refresh) 덮어쓴 값은 버린다(AppShell).
 */
export type SidebarBadgesApi = {
  /** 이 채널을 읽었다 — clearedMentions 는 서버가 읽음으로 바꾼 멘션 수 */
  markRead: (channelId: string, clearedMentions: number) => void
  /**
   * 서버에서 새로 읽은 배지 스냅샷(getSidebarBadges)을 반영한다 — router.refresh() 없이 숫자만 맞춘다.
   * `requestedAt`(ms) = 스냅샷 조회를 시작한 시각(생략하면 지금). 그 뒤에 기록된 읽음 표시는 스냅샷이 아직
   * 모를 수 있어 유지하고, 그 전에 기록된 읽음은 스냅샷이 이미 반영했으므로 버린다(effectiveReads).
   * 서버가 새 셸 데이터를 보내오면(props 변경) 스냅샷도 버린다.
   */
  applySnapshot: (snapshot: SidebarBadgeSnapshot, requestedAt?: number) => void
  /**
   * 이 채널에 새 메시지가 왔다(at = ms) — lastActivityAt 을 올려 최근 활동순 목록을 서버 조회 없이 재정렬한다(0030).
   * 서버가 새 셸 데이터를 보내오면(props 변경) 버린다.
   */
  bumpActivity: (channelId: string, at: number) => void
}

const SidebarBadgesContext = createContext<SidebarBadgesApi | null>(null)

export const SidebarBadgesProvider = SidebarBadgesContext.Provider

/** 셸 밖(테스트·단독 렌더)에서는 null — 호출하는 쪽이 router.refresh 로 대신한다 */
export function useSidebarBadges(): SidebarBadgesApi | null {
  return useContext(SidebarBadgesContext)
}

/** 읽음 처리한 채널(값 = 그 채널에서 지운 멘션 수 누계) */
export type LocalReads = ReadonlyMap<string, number>

/** 읽음 기록: 이 채널은 시각 `at`(ms)에 읽음 처리됐고 그때 서버가 읽음으로 바꾼 멘션이 `cleared` 개 */
export type ReadRecord = { cleared: number; at: number }

/**
 * 순수: 배지 스냅샷 위에 얹을 읽음 보정. 스냅샷 조회 시작(snapshotAt) **이후**에 기록된 읽음만 남긴다 —
 * 조회가 끝나기 전에 읽은 채널은 스냅샷 값이 읽기 전 것일 수 있어 0 으로 덮어야 하고,
 * 조회 시작 뒤의 읽음이 아니면(스냅샷이 더 새것) 스냅샷을 믿는다(그 사이 새 글이 왔으면 배지가 다시 선다).
 * 스냅샷이 없으면(null) 모든 읽음을 남긴다.
 */
export function effectiveReads(
  records: ReadonlyMap<string, ReadRecord>,
  snapshotAt: number | null
): LocalReads {
  const out = new Map<string, number>()
  for (const [id, r] of records) {
    if (snapshotAt === null || r.at >= snapshotAt) out.set(id, r.cleared)
  }
  return out
}

/** 순수: 읽은 채널의 안 읽은 수·멘션 배지를 0 으로 */
export function applyLocalReads(items: ChannelListItem[], reads: LocalReads): ChannelListItem[] {
  if (reads.size === 0) return items
  return items.map(item =>
    reads.has(item.id) && (item.unread > 0 || (item.mentions ?? 0) > 0)
      ? { ...item, unread: 0, mentions: 0 }
      : item
  )
}

/** 순수: "받은 멘션" 수에서 읽음 처리한 만큼 뺀다(0 아래로 내려가지 않는다) */
export function applyLocalMentionCount(count: number, reads: LocalReads): number {
  let cleared = 0
  for (const n of reads.values()) cleared += n
  return Math.max(0, count - cleared)
}
