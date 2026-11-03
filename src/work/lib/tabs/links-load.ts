import { listChannelLinkRecords } from '@/db/queries/work/files'
import { readableChannelIds, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { messageLink } from '@work/lib/messages/anchor'
import type { WorkServerClient } from '@work/lib/supabase/server'
import { LINKS_LIMIT, type ChannelLinks } from './links'

/**
 * 채널에서 공유된 링크(서버 전용) — 원본 kosmart-work `lib/tabs/links.ts` loadChannelLinks. 원본은 RLS 클라이언트로
 * message_links·messages·staff 를 세 번 읽었다. 여기서는 읽기 범위를 넘겨 한 번에 읽는다(읽을 수 없는 채널이면 빈 목록).
 * 순수 함수(linkHost·linkPathLabel)는 클라이언트도 쓰므로 `./links`에 남겼다.
 */
export async function loadChannelLinks(
  supabase: WorkServerClient,
  channel: { id: string; kind: string; slug: string | null },
  limit = LINKS_LIMIT
): Promise<ChannelLinks> {
  const readable = await readableChannelIds(viewerOf(supabase))
  const { items, total } = await listChannelLinkRecords(channel.id, readable, limit)
  return {
    items: items.map(r => ({
      messageId: r.messageId,
      url: r.url,
      createdAt: r.createdAt,
      authorName: r.authorName,
      messageHref: messageLink({
        channelId: channel.id,
        kind: channel.kind,
        slug: channel.slug,
        messageId: r.messageId,
        parentId: r.parentId,
      }),
    })),
    total,
  }
}
