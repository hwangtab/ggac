import { z } from 'zod'
import type { SidebarBadgeSnapshot } from '@work/lib/channels/badge-snapshot'

/**
 * 폴링 동기화 계약 — `POST /api/board-room/work/sync`. 정본 설명은 docs/board-work/02-sync.md.
 * 클라이언트 폴러(`lib/messages/realtime.ts`의 내부)와 라우트가 이 파일 하나를 같이 쓴다.
 */

/** 한 요청에 실을 수 있는 채널 수 */
export const SYNC_MAX_CHANNELS = 50
/** 채널 하나에서 돌려줄 바뀐 메시지 id 상한 — 넘으면 그 채널은 resync(최신 페이지 다시 읽기) */
export const SYNC_MAX_MESSAGE_IDS = 200
/** 입력 중 표시가 살아 있는 시간 */
export const SYNC_TYPING_TTL_MS = 5_000
/** 접속 중으로 보는 시간 */
export const SYNC_ONLINE_TTL_MS = 60_000
/** 접속 시각을 다시 쓰는 최소 간격 */
export const SYNC_PRESENCE_WRITE_MS = 30_000

const uuid = z.string().uuid()
const rev = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const syncRequestSchema = z.object({
  /** 보고 있는 채널 → 클라이언트가 마지막으로 반영한 rev(처음이면 화면 로더가 준 `rev`) */
  channels: z
    .record(uuid, rev)
    .default({})
    .refine(v => Object.keys(v).length <= SYNC_MAX_CHANNELS, '채널이 너무 많습니다.'),
  /** 마지막으로 본 사용자 단위 변경 번호(처음이면 null — membershipChanged는 false) */
  membershipRev: rev.nullish(),
  /** 지금 보는 채널(입력 중 표시 대상)과 열린 스레드 */
  focus: z.object({ channelId: uuid, threadId: uuid.nullish() }).nullish(),
  /** 입력 중 신호. scope는 스레드 부모 id(채널 입력창이면 null) */
  typing: z.object({ channelId: uuid, scope: uuid.nullish() }).nullish(),
})

export type SyncRequest = z.input<typeof syncRequestSchema>

export type SyncChannelChange = {
  /** 지금 채널 rev — 다음 요청에 이 값을 보낸다 */
  rev: number
  /** 요청 rev 이후 바뀐 메시지(새 글·수정·삭제·반응·답글 수 변경, 답글 포함). `loadMessagesByIds`로 다시 읽는다 */
  messageIds: string[]
  /** 고정 목록이 바뀌었다 → `loadPinnedIds`·`loadPinnedMessages` */
  pinsChanged: boolean
  /** 대화 탭·노트가 바뀌었다(2단계) */
  tabsChanged: boolean
  /** 바뀐 메시지가 SYNC_MAX_MESSAGE_IDS를 넘었다 → messageIds는 비어 있고, `loadLatestMessages`로 다시 읽는다 */
  resync?: true
}

export type SyncTyping = { userId: string; displayName: string; scope: string | null }

export type SyncResponse = {
  /** rev가 바뀐 채널만. **읽을 수 없는 채널은 요청에 있어도 절대 나오지 않는다** */
  changed: Record<string, SyncChannelChange>
  /** 지금 사용자 단위 변경 번호 */
  membershipRev: number
  /** 요청의 membershipRev와 다르다 → 사이드바(채널 목록)를 다시 그린다(router.refresh) */
  membershipChanged: boolean
  /** getSidebarBadges()와 같은 모양 */
  badges: SidebarBadgeSnapshot
  /** focus 채널에서 5초 안에 입력한 사람(나 제외). focus가 없거나 읽을 수 없으면 [] */
  typing: SyncTyping[]
  /** 60초 안에 동기화한 사람(나 포함) */
  online: string[]
  /** changed 중 하나라도 resync인가 */
  resync: boolean
  serverTime: string
}
