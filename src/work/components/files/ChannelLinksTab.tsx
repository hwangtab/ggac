import { LinkIcon } from 'lucide-work'
import { EmptyState, PageBody, SectionHeading } from '@work/components/layout/page'
import ConversationPageHeader from '@work/components/chat/ConversationPageHeader'
import ConversationTabBar from '@work/components/chat/ConversationTabBar'
import { conversationBasePath } from '@work/components/chat/conversation-tabs'
import LinkList from '@work/components/tabs/LinkList'
import type { ChannelDetail } from '@work/lib/channels/types'
import { LINKS_LIMIT, type ChannelLinks } from '@work/lib/tabs/links'
import type { TabBarData } from '@work/lib/tabs/types'
import ChannelFilesSubNav from './ChannelFilesSubNav'

/**
 * 채널 "파일" 탭의 하위 보기 "링크"(`/c/<slug>/files?view=links`, 서버 컴포넌트, docs/05 §5).
 * 같은 message_links 테이블을 DM 의 공유됨 > 링크와 공유한다. 권한은 호출한 페이지의 가드와 RLS 가 맡는다.
 */
export default function ChannelLinksTab({
  channel,
  links,
  tabBar,
}: {
  channel: ChannelDetail
  links: ChannelLinks
  tabBar?: TabBarData
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationPageHeader channel={channel} />
      <ConversationTabBar conversation={channel} activeKey="files" data={tabBar} />
      <PageBody width="wide">
        <ChannelFilesSubNav base={conversationBasePath(channel)} active="links" />
        {links.items.length === 0 ? (
          <EmptyState
            icon={LinkIcon}
            as="p"
            title="아직 공유된 링크가 없습니다"
            description="게시물에 http(s) 주소를 붙이면 여기에 모입니다."
          />
        ) : (
          <section aria-labelledby="channel-links-heading" className="space-y-3">
            <SectionHeading
              id="channel-links-heading"
              count={`· ${links.total.toLocaleString('ko-KR')}개`}
            >
              링크
            </SectionHeading>
            <LinkList items={links.items} />
            {links.total > LINKS_LIMIT && (
              <p className="mt-2 text-xs text-muted-foreground">
                최근 {LINKS_LIMIT}개까지 보여 줍니다.
              </p>
            )}
          </section>
        )}
      </PageBody>
    </div>
  )
}
