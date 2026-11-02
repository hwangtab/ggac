import { getChannelRecordById } from '@/db/queries/work/channels'
import { fetchMessageRecord } from '@/db/queries/work/messages'
import { isWorkAdmin, loadChannelAccess, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { createDeniedMessage } from './create-rules'

/**
 * 서버 전용. 화면용 노출 판정 조회(create-access)와 분리해 둔다(원본과 같은 나눔).
 * 원본 kosmart-work `lib/files/create-access-check.ts` — 채널 읽기(RLS)·is_channel_member·is_work_admin 을
 * 업무툴 채널 판정(`loadChannelAccess`)으로 바꿨다.
 */

export type CreateAccessChannel = {
  id: string
  kind: 'public' | 'private' | 'dm'
  slug: string | null
  archived_at: string | null
  post_policy: string
}

/** strict: false 라 판별 유니온 대신 한 모양으로 둔다(ok 면 channel, 아니면 reason·message) */
export type CreateAccess = {
  ok: boolean
  channel?: CreateAccessChannel
  reason?: 'not_found' | 'forbidden' | 'server'
  message?: string
}

const CHANNEL_NOT_FOUND = '채널을 찾을 수 없거나 권한이 없습니다.'
const PARENT_NOT_FOUND = '답글을 달 메시지를 찾을 수 없습니다.'

/**
 * 새 문서 만들기 권한 판정(서버) — createDocument 와 같은 순서: 채널 읽기 → 멤버·서브관리자·보관·공지 채널(createDeniedMessage)
 * → 스레드면 같은 채널의 삭제 안 된 최상위 메시지. 새 HWPX 저장본 검증 라우트·`/board-room/edit/new`·액션이 같이 쓴다.
 */
export async function checkCreateAccess(
  client: WorkServerClient,
  channelId: string,
  parentId: string | null | undefined
): Promise<CreateAccess> {
  const viewer = viewerOf(client)
  let access: Awaited<ReturnType<typeof loadChannelAccess>>
  let record: Awaited<ReturnType<typeof getChannelRecordById>>
  try {
    ;[access, record] = await Promise.all([
      loadChannelAccess(viewer, channelId),
      getChannelRecordById(channelId),
    ])
  } catch {
    return { ok: false, reason: 'server', message: '처리하지 못했습니다.' }
  }
  if (!access || !access.canRead || !record) {
    return { ok: false, reason: 'not_found', message: CHANNEL_NOT_FOUND }
  }

  const inThread = Boolean(parentId)
  const denied = createDeniedMessage({
    isGuest: client.staff.role === 'guest',
    isMember: access.isMember,
    archived: access.archived,
    postPolicy: access.postPolicy,
    isChannelOwner: access.isOwner,
    isAdmin: isWorkAdmin(viewer),
    inThread,
  })
  if (denied) return { ok: false, reason: 'forbidden', message: denied }

  if (parentId) {
    let parent: Awaited<ReturnType<typeof fetchMessageRecord>>
    try {
      parent = await fetchMessageRecord(parentId, new Set([channelId]))
    } catch {
      return { ok: false, reason: 'server', message: '처리하지 못했습니다.' }
    }
    if (!parent || parent.channel_id !== channelId || parent.deleted_at || parent.parent_id) {
      return { ok: false, reason: 'not_found', message: PARENT_NOT_FOUND }
    }
  }
  return {
    ok: true,
    channel: {
      id: record.id,
      kind: record.kind === 'private' || record.kind === 'dm' ? record.kind : 'public',
      slug: record.slug,
      archived_at: record.archived_at,
      post_policy: record.post_policy,
    },
  }
}
