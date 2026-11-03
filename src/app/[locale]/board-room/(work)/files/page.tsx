import type { Metadata } from 'next'
import Link from '@work/lib/nav/link'
import { ArrowUpIcon, ChevronRightIcon, FolderOpenIcon } from 'lucide-work'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { EmptyState, PageBody, PageHeader } from '@work/components/layout/page'
import FilesBrowser from '@work/components/files/FilesBrowser'
import FolderSearchNotice from '@work/components/files/FolderSearchNotice'
import FilesFilters, { filesHref } from '@work/components/files/FilesFilters'
import VersionsToggle from '@work/components/files/versions/VersionsToggle'
import NewDocumentMenu from '@work/components/files/create-document/NewDocumentMenu'
import { loadCreateDocActor } from '@work/lib/files/create-access'
import { buttonVariants } from '@work/components/ui/button'
import {
  filesFolderHref,
  parseChannelFilesSearch,
  type ChannelFilesData,
} from '@work/lib/files/channel-files'
import { loadChannelFiles } from '@work/lib/files/channel-files-load'
import { folderCrumbs, folderSummary, parentFolder } from '@work/lib/files/folders'
import { getFilterOptions, listFiles } from '@work/lib/files/queries'
import { parseFilesSearch } from '@work/lib/files/schema'
import { parseBoardFolder } from '@work/lib/files/board-folders'
import BoardDocumentsFolder from '@work/components/files/board-documents/BoardDocumentsFolder'
import BoardFolderNav from '@work/components/files/board-documents/BoardFolderNav'

export const metadata: Metadata = { title: '자료실' }

// 쿠키 기반 세션 — 빌드 시 정적 생성·DB 호출을 하지 않는다.
export const dynamic = 'force-dynamic'

/**
 * 자료실 — 원본 kosmart-work `app/(app)/files/page.tsx`. 내가 읽을 수 있는 채널의 첨부 모음(읽기 범위 — 원본 RLS).
 * 채널을 고르고 검색어·형식·올린 사람·기간 필터가 없으면 폴더 탐색(채널 파일 탭과 같은 방식: 브레드크럼 + 하위
 * 폴더 행 + 그 폴더 직속 파일, `?path=`). 필터나 검색어가 있으면 폴더(path)를 무시한 평면 목록이다.
 *
 * ggac 이식: 게스트(서브관리자)는 1단계부터 쓰지 않아 원본의 게스트 분기(채널 지정 링크만·올린 사람 후보 한정)를 뺐다.
 * 폴더 탐색일 때 새 문서 만들기(NewDocumentMenu — 편집기 출처 env·PC 일 때만 보인다, 3단계).
 * `data-testid="board-work-files"`는 권한 E2E 표식이다.
 *
 * `?board=<분류>`면 '이사회 서류' 폴더다(03 §10 — 서류함 통합): `board_documents`를 분류별로 보인다(BoardDocumentsFolder).
 */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await requireWorkStaff()
  const raw = await searchParams
  const boardFolder = parseBoardFolder(raw.board)
  if (boardFolder) {
    const doc = Array.isArray(raw.doc) ? raw.doc[0] : raw.doc
    return <BoardDocumentsFolder ctx={supabase} category={boardFolder} openDocId={doc ?? null} />
  }
  const search = parseFilesSearch(raw)

  // 폴더 탐색: 채널 지정 + 검색·형식·올린 사람·기간 필터 없음. 그 밖에는 평면 목록(path 무시)
  const folderChannel =
    search.channel && !search.q && !search.uploader && !search.kind && !search.from && !search.to
      ? search.channel
      : null
  const folderSearch = parseChannelFilesSearch(raw)

  const [list, allOptions, createDocActor] = await Promise.all([
    folderChannel
      ? loadChannelFiles(supabase, folderChannel, folderSearch)
      : listFiles(supabase, search).then((l): ChannelFilesData => ({ ...l, folders: [] })),
    getFilterOptions(supabase),
    folderChannel ? loadCreateDocActor(supabase, folderChannel) : null,
  ])
  const { items, total, hasMore, folders } = list
  const channelName = allOptions.channels.find(c => c.id === folderChannel)?.name ?? '채널'
  const options = allOptions
  const pageHref = (page: number) =>
    folderChannel
      ? filesFolderHref(folderChannel, { ...folderSearch, page })
      : filesHref({ ...search, page })
  const filtered =
    !folderChannel &&
    Boolean(
      search.q || search.channel || search.uploader || search.kind || search.from || search.to
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="board-work-files">
      <PageHeader
        title="자료실"
        hideOnMobile
        subtitle={
          folderChannel
            ? folderSummary(folderSearch.path, total, folders.length, hasMore)
            : `${total.toLocaleString('ko-KR')}개${hasMore ? ' 이상' : ''} 파일`
        }
      />
      <PageBody width="wide" innerClassName="space-y-4">
        {supabase.staff.role !== 'guest' && <BoardFolderNav active={null} />}
        <FilesFilters search={search} options={options} />

        <div className="flex items-center justify-end gap-2">
          {folderChannel && createDocActor && (
            <NewDocumentMenu
              channelId={folderChannel}
              folderPath={folderSearch.path || null}
              actor={createDocActor}
            />
          )}
          <VersionsToggle
            active={search.versions === 'all'}
            href={
              folderChannel
                ? filesFolderHref(folderChannel, {
                    ...folderSearch,
                    versions: search.versions === 'all' ? undefined : 'all',
                    page: 1,
                  })
                : filesHref({
                    ...search,
                    versions: search.versions === 'all' ? undefined : 'all',
                    page: 1,
                  })
            }
          />
        </div>

        {!folderChannel && search.channel && search.path && (
          <FolderSearchNotice
            channelId={search.channel}
            channelName={allOptions.channels.find(c => c.id === search.channel)?.name ?? '채널'}
            path={search.path}
          />
        )}

        {folderChannel && (
          <nav aria-label="폴더 경로">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm">
              <li className="flex items-center gap-1.5">
                {folderCrumbs(folderSearch.path).length === 0 ? (
                  <span aria-current="page" className="font-semibold">
                    # {channelName}
                  </span>
                ) : (
                  <Link
                    href={filesFolderHref(folderChannel, { ...folderSearch, path: '', page: 1 })}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    # {channelName}
                  </Link>
                )}
              </li>
              {folderCrumbs(folderSearch.path).map((crumb, i, all) => (
                <li key={crumb.path} className="flex items-center gap-1.5">
                  <ChevronRightIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  {i === all.length - 1 ? (
                    <span aria-current="page" className="font-semibold break-all">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      href={filesFolderHref(folderChannel, {
                        ...folderSearch,
                        path: crumb.path,
                        page: 1,
                      })}
                      className="text-muted-foreground break-all hover:text-foreground hover:underline"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </li>
              ))}
              {folderSearch.path && (
                <li className="ml-auto">
                  <Link
                    href={filesFolderHref(folderChannel, {
                      ...folderSearch,
                      path: parentFolder(folderSearch.path),
                      page: 1,
                    })}
                    className="inline-flex h-7 pointer-coarse:h-11 items-center gap-1.5 rounded-w-lg border px-2 text-xs outline-none hover:bg-accent"
                  >
                    <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                    상위 폴더
                  </Link>
                </li>
              )}
            </ol>
          </nav>
        )}

        {items.length === 0 && folders.length === 0 ? (
          <EmptyState
            icon={FolderOpenIcon}
            as="p"
            title={filtered ? '조건에 맞는 파일이 없습니다' : '아직 공유된 파일이 없습니다'}
            description={
              filtered
                ? '검색어나 필터를 바꿔 보세요.'
                : folderChannel && folderSearch.path
                  ? '이 폴더에는 파일이 없습니다.'
                  : '채널에서 파일을 첨부하면 여기에 모입니다.'
            }
          />
        ) : (
          <FilesBrowser
            items={items}
            view={search.view}
            channelMode={
              folderChannel
                ? { base: '', channelId: folderChannel, folders, search: folderSearch }
                : undefined
            }
          />
        )}

        {(search.page > 1 || hasMore) && (
          <nav aria-label="페이지" className="flex items-center justify-center gap-3 text-sm">
            {search.page > 1 ? (
              <Link
                href={pageHref(search.page - 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                이전
              </Link>
            ) : null}
            <span aria-current="page">{search.page}쪽</span>
            {hasMore ? (
              <Link
                href={pageHref(search.page + 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                다음
              </Link>
            ) : null}
          </nav>
        )}
      </PageBody>
    </div>
  )
}
