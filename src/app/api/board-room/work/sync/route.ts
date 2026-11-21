import { NextRequest, NextResponse } from 'next/server'
import { apiPost, ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { loadWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  loadChannelAccess,
  readableChannelIds,
  visibleStaffIds,
  type WorkViewer,
} from '@/lib/server/boardWorkChannelAuth'
import { consumeWorkSync } from '@/lib/server/boardWorkRateLimit'
import { LARGE_JSON_BODY_MAX_BYTES, parseJsonObjectBody } from '@/utils/requestBody'
import { listChangedMessageIds } from '@/db/queries/work/messages'
import { countMyOpenTaskRecords } from '@/db/queries/work/tasks'
import { getDisplayNames } from '@/db/queries/work/directory'
import {
  getChannelRevs,
  getMembershipRev,
  getPresence,
  listPresence,
  listTyping,
  touchPresence,
  upsertTyping,
} from '@/db/queries/work/sync'
import { loadSidebarBadges } from '@work/lib/channels/badges'
import {
  SYNC_MAX_MESSAGE_IDS,
  SYNC_ONLINE_TTL_MS,
  SYNC_PRESENCE_WRITE_MS,
  SYNC_TYPING_TTL_MS,
  syncRequestSchema,
  type SyncChannelChange,
  type SyncResponse,
} from '@work/lib/sync/contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 이사회 업무툴 폴링 동기화 — 원본 Supabase Realtime(브로드캐스트·Presence·typing) 자리.
 * 계약: docs/board-work/02-sync.md, 타입: `src/work/lib/sync/contract.ts`.
 *
 * 권한:
 * 1. `requireBoardMember()`(이사·감사·관리자 — 업무툴 진입 게이트와 같은 `canAccessBoardRoom`). 조합원은 403.
 * 2. `loadWorkStaff`로 업무툴 역할(관리자 여부)을 만든다.
 * 3. 요청의 채널 id는 **읽기 범위(`readableChannelIds`, 원본 can_read_channel 0037)로 먼저 거른다.**
 *    읽을 수 없는 채널은 rev·메시지 id·고정 여부가 하나도 응답에 나오지 않는다(있는지조차 알리지 않는다).
 *    관리자도 자기가 없는 DM·그룹은 읽지 못한다.
 * 4. 입력 중 신호는 그 채널의 **멤버**일 때만 기록하고, **멤버에게만** 돌려준다(원본 채널 토픽 읽기·쓰기 인가와 같다).
 * 5. 배지의 열린 할 일 수(`badges.openTaskCount`)도 3의 읽기 범위 안 채널만 센다(사이드바 '할 일' 배지와 같은 규칙).
 */
export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const staff = await loadWorkStaff(user.id)
      if (!staff) throw ApiError.forbidden('이사회 구성원(이사·감사)과 관리자만 쓸 수 있습니다.')
      const limited = await consumeWorkSync(user.id, request)
      if (!limited.ok) throw ApiError.tooManyRequests(limited.message)

      const body = await parseJsonObjectBody(request, { maxBytes: LARGE_JSON_BODY_MAX_BYTES })
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const parsed = syncRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw ApiError.badRequest(parsed.error.issues[0]?.message ?? '잘못된 동기화 요청입니다.')
      }
      const req = parsed.data
      const viewer: WorkViewer = { userId: user.id, role: staff.role }
      const now = new Date()

      const readable = await readableChannelIds(viewer)

      // 입력 중 기록(멤버만). 실패해도 동기화는 계속한다
      if (req.typing && readable.has(req.typing.channelId)) {
        const access = await loadChannelAccess(viewer, req.typing.channelId).catch(() => null)
        if (access?.isMember) {
          await upsertTyping(req.typing.channelId, req.typing.scope ?? '', user.id, now).catch(e =>
            console.error('[work/sync] 입력 중 기록 실패:', e)
          )
        }
      }

      // 접속 시각(30초에 한 번만 쓴다)
      const lastSeen = await getPresence(user.id).catch(() => null)
      if (lastSeen === null || now.getTime() - lastSeen >= SYNC_PRESENCE_WRITE_MS) {
        await touchPresence(user.id, now).catch(e =>
          console.error('[work/sync] 접속 기록 실패:', e)
        )
      }

      // 채널 변경 — 읽을 수 있는 것만
      const requested = Object.entries(req.channels).filter(([id]) => readable.has(id))
      const revs = await getChannelRevs(requested.map(([id]) => id))
      const changed: Record<string, SyncChannelChange> = {}
      let resync = false
      for (const [channelId, since] of requested) {
        const cur = revs.get(channelId)
        if (!cur || cur.rev === since) continue
        const entry: SyncChannelChange = {
          rev: cur.rev,
          messageIds: [],
          pinsChanged: cur.pinsRev > since,
          tabsChanged: cur.tabsRev > since,
        }
        if (cur.rev < since) {
          // 클라이언트 커서가 서버보다 앞선다(잘못된 값) — 최신 페이지부터 다시
          entry.resync = true
          entry.pinsChanged = true
          entry.tabsChanged = true
        } else {
          const ids = await listChangedMessageIds(channelId, since, cur.rev, SYNC_MAX_MESSAGE_IDS)
          if (ids.length > SYNC_MAX_MESSAGE_IDS) entry.resync = true
          else entry.messageIds = ids
        }
        if (entry.resync) resync = true
        changed[channelId] = entry
      }

      const membershipRev = await getMembershipRev(user.id)
      const membershipChanged =
        req.membershipRev !== null &&
        req.membershipRev !== undefined &&
        req.membershipRev !== membershipRev

      const [sidebarBadges, openTaskCount] = await Promise.all([
        loadSidebarBadges({ user: { id: user.id }, staff }),
        // 메뉴 '할 일' 배지 — 업무 화면 밖에서도 주기마다 맞춘다. 위에서 구한 읽기 범위(readable) 안의 채널만 센다
        countMyOpenTaskRecords({ userId: user.id, readable }),
      ])
      const badges = { ...sidebarBadges, openTaskCount }

      const visible = await visibleStaffIds(viewer)
      // 입력 중 표시는 그 채널의 **멤버**에게만 보인다. 원본은 채널 토픽(typing broadcast)을 멤버만 받았다
      // (0001 work_channel_topic_read — is_channel_topic_member). 읽기 범위(readable)로만 거르면 멤버가 아닌
      // 관리자가 비공개 채널의 입력 중 신호를 본다(독립 권한 검토 2026-11-02).
      const focusIsMember =
        req.focus && readable.has(req.focus.channelId)
          ? ((await loadChannelAccess(viewer, req.focus.channelId).catch(() => null))?.isMember ??
            false)
          : false
      const typingRows =
        req.focus && focusIsMember
          ? await listTyping(
              req.focus.channelId,
              new Date(now.getTime() - SYNC_TYPING_TTL_MS),
              user.id
            )
          : []
      const typers = typingRows.filter(t => !visible || visible.has(t.user_id))
      const names = await getDisplayNames(typers.map(t => t.user_id))
      const presence = await listPresence(new Date(now.getTime() - SYNC_ONLINE_TTL_MS))

      const response: SyncResponse = {
        changed,
        membershipRev,
        membershipChanged,
        badges,
        typing: typers.map(t => ({
          userId: t.user_id,
          displayName: names.get(t.user_id) ?? '알 수 없음',
          scope: t.scope === '' ? null : t.scope,
        })),
        online: presence.map(p => p.user_id).filter(id => !visible || visible.has(id)),
        resync,
        serverTime: now.toISOString(),
      }
      return ApiSuccess.ok(response)
    },
    '/api/board-room/work/sync',
    { userId: user.id, cacheControl: 'no-store' }
  )
}
