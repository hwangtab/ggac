import type { SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'

/**
 * 폴링 클라이언트(`lib/messages/realtime.ts`)의 순수 규칙 — 주기·새 글 판정·활동 순서. 단위 테스트가 이 파일을 직접 읽는다
 * (scripts/testing/boardWorkSyncClient.test.mjs). 계약: docs/board-work/02-sync.md §5, 설계 §6-3.
 */

/** 채널·스레드를 보는 중 */
export const POLL_FOCUSED_MS = 3_000
/** 채팅 화면이 아님(배지·접속 표시만) */
export const POLL_IDLE_MS = 10_000
/** 연속 실패 백오프 */
export const POLL_BACKOFF_MS = [3_000, 6_000, 12_000, 30_000] as const

/** 다음 폴까지 기다릴 시간. failures = 연속 실패 수(0이면 정상 주기) */
export function nextPollDelay(opts: { focused: boolean; failures: number }): number {
  if (opts.failures > 0) {
    return POLL_BACKOFF_MS[Math.min(opts.failures, POLL_BACKOFF_MS.length) - 1]
  }
  return opts.focused ? POLL_FOCUSED_MS : POLL_IDLE_MS
}

/**
 * 다시 읽은 행 하나의 op(원본 Realtime의 INSERT/UPDATE 자리). 지난 응답 시각(since, ms) 뒤에 만들어졌고 고치거나 지운 적이
 * 없으면 새 글이다. 지난 응답이 없으면(since null — 처음 붙은 뒤 첫 변경) 새 글로 본다. 받는 쪽은 둘을 같은 리듀서(upsert)로
 * 처리하므로 잘못 갈라도 화면이 틀어지지 않는다(입력 중 표시만 먼저 지워질 수 있다).
 */
export function messageOp(
  row: { created_at: string; edited_at: string | null; deleted_at: string | null },
  since: number | null
): 'INSERT' | 'UPDATE' {
  if (row.edited_at || row.deleted_at) return 'UPDATE'
  if (since === null) return 'INSERT'
  const created = Date.parse(row.created_at)
  return Number.isNaN(created) || created > since ? 'INSERT' : 'UPDATE'
}

/**
 * 직전 배지 스냅샷보다 안 읽은 수가 늘어난 채널(= 새 글이 온 채널). 최근 활동순 목록을 서버 조회 없이 올린다(원본 0030).
 * 첫 스냅샷(prev 없음)은 비교 대상이 없어 아무것도 올리지 않는다.
 */
export function channelsWithNewActivity(
  prev: SidebarBadgeSnapshot | null,
  next: SidebarBadgeSnapshot
): string[] {
  if (!prev) return []
  const out: string[] = []
  for (const [id, c] of Object.entries(next.channels)) {
    if (c.unread > (prev.channels[id]?.unread ?? 0)) out.push(id)
  }
  return out
}
