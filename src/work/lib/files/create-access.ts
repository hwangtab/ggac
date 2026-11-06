import { listMyActiveMemberships } from '@/db/queries/work/channels'
import { isWorkAdmin, loadChannelAccess, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { canOfferCreateDocument, type CreateActor, type CreateChannelOption } from './create-rules'

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

/**
 * 자료실 **첫 화면**(채널을 고르지 않은 상태)의 "새로 만들기"가 고를 수 있는 채널 목록.
 *
 * 왜 필요한가(2026-11-06): 그 화면에는 만들기 진입점이 아예 없어서, 사용자가 채널을 먼저 고른 뒤에야
 * 버튼이 나타났다. 사이드바에는 "#전체"·"기타" 같은 채널 이름만 보이므로 "문서를 어디서 만드나"를
 * 알 수 없다는 혼동이 그대로 남았다. 채널을 고르는 일을 대화상자 안으로 옮긴다.
 *
 * 목록은 **지금 새 문서를 만들 수 있는 채널만** 담는다 — 채널마다 `loadCreateDocActor`와 같은 규칙
 * (`canOfferCreateDocument`)으로 판정하므로, 고를 수 있는데 눌렀더니 거절되는 채널은 목록에 없다.
 * 화면 노출용일 뿐 실제 차단은 여전히 `createDocument`가 한다(기존 규약 그대로).
 * DM은 폴더가 없어 제외한다(채널 파일 탭과 같은 이유).
 */
export async function loadCreatableChannels(
  client: WorkServerClient
): Promise<CreateChannelOption[]> {
  const rows = await listMyActiveMemberships(client.user.id)
  const channels = rows.map(row => row.channel).filter(channel => channel.kind !== 'dm')
  const judged = await Promise.all(
    channels.map(async channel => {
      const actor = await loadCreateDocActor(client, channel.id)
      if (!actor) return null
      return canOfferCreateDocument({ ...actor, inThread: false })
        ? { id: channel.id, name: channel.name }
        : null
    })
  )
  return judged
    .filter((channel): channel is CreateChannelOption => channel !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
