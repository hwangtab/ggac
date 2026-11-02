import Link from '@work/lib/nav/link'
import { ChevronRightIcon, FolderOpenIcon, SearchIcon } from 'lucide-work'
import { EmptyState, PageBody, SectionHeading } from '@work/components/layout/page'
import ConversationPageHeader from '@work/components/chat/ConversationPageHeader'
import ConversationTabBar from '@work/components/chat/ConversationTabBar'
import { conversationBasePath } from '@work/components/chat/conversation-tabs'
import { Button, buttonVariants } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import type { ChannelDetail } from '@work/lib/channels/types'
import type { TabBarData } from '@work/lib/tabs/types'
import {
  channelFilesHref,
  type ChannelFilesData,
  type ChannelFilesSearch,
} from '@work/lib/files/channel-files'
import { folderCrumbs } from '@work/lib/files/folders'
import type { CreateActor } from '@work/lib/files/create-rules'
import ChannelFilesSubNav from './ChannelFilesSubNav'
import NewDocumentMenu from './create-document/NewDocumentMenu'
import FilesBrowser from './FilesBrowser'
import { toWorkHref } from '@work/lib/nav/paths'
import VersionsToggle from './versions/VersionsToggle'

/**
 * 채널·DM 의 "파일" 탭(서버 컴포넌트). 머리글 + 탭 바 + 검색 + 폴더 브레드크럼 + 목록(+폴더 행).
 * 목록·상세·미리보기는 자료실 FilesBrowser 를 그대로 쓴다. 권한은 호출한 페이지의 가드와 RLS 가 맡는다.
 */
export default function ChannelFilesTab({
  channel,
  search,
  data,
  tabBar,
  createDocActor,
}: {
  channel: ChannelDetail
  search: ChannelFilesSearch
  data: ChannelFilesData
  /** 대화 탭 바 데이터(추가 탭·권한). 없으면 기본 탭만 그린다 */
  tabBar?: TabBarData
  /** 새 문서 만들기 판정 재료(docs/16). 없으면 버튼을 그리지 않는다 */
  createDocActor?: Omit<CreateActor, 'inThread'>
}) {
  const base = conversationBasePath(channel)
  const searching = Boolean(search.q)
  const crumbs = folderCrumbs(search.path)
  // ggac 이식: 문서 본문 검색 결과(원본 documentHits·DocumentHitList, 0029)는 4단계(본문 추출·검색)다
  const empty = data.items.length === 0 && data.folders.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationPageHeader channel={channel} />
      <ConversationTabBar conversation={channel} activeKey="files" data={tabBar} />

      <PageBody width="wide">
        {channel.kind !== 'dm' && <ChannelFilesSubNav base={base} active="files" />}
        <form
          method="get"
          action={toWorkHref(`${base}/files`)}
          role="search"
          aria-label="파일 검색"
          className="flex items-center gap-2"
        >
          <input type="hidden" name="path" value={search.path} />
          {search.sort !== 'name' && <input type="hidden" name="sort" value={search.sort} />}
          {search.dir !== 'asc' && <input type="hidden" name="dir" value={search.dir} />}
          {search.versions === 'all' && <input type="hidden" name="versions" value="all" />}
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              name="q"
              defaultValue={search.q ?? ''}
              placeholder="이 채널의 파일명·문서 내용 검색"
              aria-label="파일명·문서 내용 검색"
              className="pl-8"
            />
          </div>
          <Button type="submit">검색</Button>
        </form>

        <div className="flex items-center justify-end gap-2">
          {createDocActor && !searching && (
            <NewDocumentMenu
              channelId={channel.id}
              folderPath={search.path || null}
              actor={createDocActor}
            />
          )}
          <VersionsToggle
            active={search.versions === 'all'}
            href={channelFilesHref(base, {
              ...search,
              versions: search.versions === 'all' ? undefined : 'all',
              page: 1,
            })}
          />
        </div>

        {searching ? (
          <p className="text-sm text-muted-foreground">
            ‘{search.q}’ 검색 결과 {data.total.toLocaleString('ko-KR')}개
            {data.hasMore ? ' 이상' : ''} ·{' '}
            <Link
              href={channelFilesHref(base, { ...search, q: undefined, page: 1 })}
              className="text-foreground underline"
            >
              폴더 보기로 돌아가기
            </Link>
          </p>
        ) : (
          <nav aria-label="폴더 경로">
            <ol className="flex flex-wrap items-center gap-1 text-sm">
              <li className="flex items-center gap-1">
                {crumbs.length === 0 ? (
                  <span aria-current="page" className="font-semibold">
                    파일
                  </span>
                ) : (
                  <Link
                    href={channelFilesHref(base, { ...search, path: '', page: 1 })}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    파일
                  </Link>
                )}
              </li>
              {crumbs.map((crumb, i) => (
                <li key={crumb.path} className="flex items-center gap-1">
                  <ChevronRightIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  {i === crumbs.length - 1 ? (
                    <span aria-current="page" className="font-semibold break-all">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      href={channelFilesHref(base, { ...search, path: crumb.path, page: 1 })}
                      className="text-muted-foreground break-all hover:text-foreground hover:underline"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        {empty ? (
          <EmptyState
            icon={FolderOpenIcon}
            as="p"
            title={
              searching
                ? '조건에 맞는 파일이 없습니다'
                : search.path
                  ? '이 폴더에는 파일이 없습니다'
                  : '아직 공유된 파일이 없습니다'
            }
            description={
              !searching && !search.path
                ? '게시물 탭에서 파일을 첨부하면 여기에 모입니다.'
                : undefined
            }
          />
        ) : (
          <>
            {(data.items.length > 0 || data.folders.length > 0) && (
              <FilesBrowser
                items={data.items}
                view="list"
                channelMode={{ base, folders: data.folders, search }}
              />
            )}
          </>
        )}

        {(search.page > 1 || data.hasMore) && (
          <nav aria-label="페이지" className="flex items-center justify-center gap-3 text-sm">
            {search.page > 1 && (
              <Link
                href={channelFilesHref(base, { ...search, page: search.page - 1 })}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                이전
              </Link>
            )}
            <span aria-current="page">{search.page}쪽</span>
            {data.hasMore && (
              <Link
                href={channelFilesHref(base, { ...search, page: search.page + 1 })}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                다음
              </Link>
            )}
          </nav>
        )}
      </PageBody>
    </div>
  )
}
