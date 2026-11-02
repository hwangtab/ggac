import { FolderOpenIcon } from 'lucide-work'
import { EmptyState, SectionHeading } from '@work/components/layout/page'
import LinkList from '@work/components/tabs/LinkList'
import FilesBrowser from '@work/components/files/FilesBrowser'
import type { ChannelDetail } from '@work/lib/channels/types'
import type { SharedData } from '@work/lib/tabs/shared'
import { LINKS_LIMIT } from '@work/lib/tabs/links'
import { SHARED_FILES_LIMIT, SHARED_PHOTOS_LIMIT } from '@work/lib/tabs/shared'
import type { TabBarData } from '@work/lib/tabs/types'
import ConversationPageHeader from './ConversationPageHeader'
import ConversationTabBar from './ConversationTabBar'

/**
 * DM·그룹 "공유됨" 탭(서버 컴포넌트, docs/05 §5): 파일 목록 + 사진 격자 + 링크 목록(message_links).
 * 파일·사진의 목록·상세·미리보기는 자료실 FilesBrowser 를 그대로 쓴다.
 */
export default function SharedTab({
  channel,
  data,
  tabBar,
}: {
  channel: ChannelDetail
  data: SharedData
  tabBar?: TabBarData
}) {
  const empty = data.files.length === 0 && data.photos.length === 0 && data.links.items.length === 0
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationPageHeader channel={channel} />
      <ConversationTabBar conversation={channel} activeKey="shared" data={tabBar} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {empty ? (
          <EmptyState
            icon={FolderOpenIcon}
            title="아직 공유된 파일, 사진, 링크가 없습니다"
            description="채팅에서 파일을 첨부하거나 링크를 붙이면 여기에 모입니다."
          />
        ) : (
          <>
            <section aria-labelledby="shared-files-heading">
              <SectionHeading
                id="shared-files-heading"
                className="mb-2"
                count={`· ${data.files.length}개`}
              >
                파일
              </SectionHeading>
              {data.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">공유된 파일이 없습니다.</p>
              ) : (
                <FilesBrowser items={data.files} view="list" />
              )}
              {data.filesHasMore && (
                <p className="mt-2 text-xs text-muted-foreground">
                  최근 {SHARED_FILES_LIMIT}개까지 보여 줍니다.
                </p>
              )}
            </section>
            <section aria-labelledby="shared-photos-heading">
              <SectionHeading
                id="shared-photos-heading"
                className="mb-2"
                count={`· ${data.photosTotal.toLocaleString('ko-KR')}장${data.photosHasMore ? ' 이상' : ''}`}
              >
                사진
              </SectionHeading>
              {data.photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">공유된 사진이 없습니다.</p>
              ) : (
                <FilesBrowser items={data.photos} view="grid" />
              )}
              {data.photosHasMore && (
                <p className="mt-2 text-xs text-muted-foreground">
                  최근 {SHARED_PHOTOS_LIMIT}장까지 보여 줍니다.
                </p>
              )}
            </section>
            <section aria-labelledby="shared-links-heading">
              <SectionHeading
                id="shared-links-heading"
                className="mb-2"
                count={`· ${data.links.total.toLocaleString('ko-KR')}개`}
              >
                링크
              </SectionHeading>
              {data.links.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">공유된 링크가 없습니다.</p>
              ) : (
                <LinkList items={data.links.items} />
              )}
              {data.links.total > LINKS_LIMIT && (
                <p className="mt-2 text-xs text-muted-foreground">
                  최근 {LINKS_LIMIT}개까지 보여 줍니다.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
