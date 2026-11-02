import { isWorkAdmin, loadChannelAccess, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import type { CreateActor } from './create-rules'

/**
 * 서버 페이지가 "새로 만들기" 버튼의 노출 판정 재료(CreateActor 에서 inThread 제외)를 모으는 조회 — 원본 kosmart-work
 * `lib/files/create-access.ts`. 전역 자료실(`/files?channel=<id>`)처럼 채널 객체를 따로 들고 있지 않은 화면용.
 * 화면 노출용일 뿐 실제 차단은 createDocument 가 한다. 채널을 읽을 수 없거나 DM(폴더 없음)이면 null — 버튼을 숨긴다.
 */
export async function loadCreateDocActor(
  client: WorkServerClient,
  channelId: string
): Promise<Omit<CreateActor, 'inThread'> | null> {
  const viewer = viewerOf(client)
  const access = await loadChannelAccess(viewer, channelId)
  if (!access || !access.canRead || access.kind === 'dm') return null
  return {
    isGuest: client.staff.role === 'guest',
    isMember: access.isMember,
    archived: access.archived,
    postPolicy: access.postPolicy,
    isChannelOwner: access.isOwner,
    isAdmin: isWorkAdmin(viewer),
  }
}
