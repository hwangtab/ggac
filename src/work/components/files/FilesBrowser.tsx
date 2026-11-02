'use client'

import { useMemo, useState } from 'react'
import { DataTable, TBody, Td, Th, THead, Tr } from '@work/components/layout/data-table'
import Link from '@work/lib/nav/link'
import { ArrowDownIcon, ArrowUpIcon, FolderIcon } from 'lucide-work'
import { useRightPanel } from '@work/components/layout/RightPanel'
import { chatKindLabel } from '@work/lib/channels/group'
import {
  channelFilesHref,
  filesFolderHref,
  type ChannelFileSortKey,
  type ChannelFilesSearch,
  type ChannelFolder,
} from '@work/lib/files/channel-files'
import { formatDateTime } from '@work/lib/format/datetime'
import { FILE_KIND_LABEL, fileKindOf, formatBytes, isBrowserImage } from '@work/lib/files/mime'
import type { FileListItem } from '@work/lib/files/queries'
import { cn } from '@work/lib/utils'
import FileDetail from './FileDetail'
import FileIcon from './FileIcon'
import FilePreviewDialog, { fileUrl } from './FilePreviewDialog'
import { OldVersionBadge, VersionNumberBadge } from './versions/VersionBadges'

function channelLabel(item: FileListItem): string {
  if (!item.channels) return '-'
  return item.channels.kind === 'dm' ? chatKindLabel(item.channels.name) : `# ${item.channels.name}`
}

/** 채널 파일 탭 모드: 목록형 고정 + 폴더 행 + 정렬 가능한 머리글 + 폴더 열(채널 열 대신) */
export type FilesBrowserChannelMode = {
  /** `/c/<slug>` 또는 `/dm/<id>` — 폴더·정렬 링크의 기준(channelId 가 있으면 쓰지 않는다) */
  base: string
  /** 전역 자료실(`/files?channel=<id>`)의 폴더 탐색이면 그 채널 id — 링크가 `/files?...` 로 간다 */
  channelId?: string
  folders: ChannelFolder[]
  search: ChannelFilesSearch
}

function modeHref(mode: FilesBrowserChannelMode, s: Partial<ChannelFilesSearch>): string {
  return mode.channelId ? filesFolderHref(mode.channelId, s) : channelFilesHref(mode.base, s)
}

/**
 * 자료실 목록(그리드/목록). 항목을 누르면 우측 패널에 파일 상세, 상세의 "미리보기"가 라이트박스를 연다.
 * 보기 방식(view)은 서버가 URL 에서 결정해 내려준다.
 */
export default function FilesBrowser({
  items,
  view,
  channelMode,
}: {
  items: FileListItem[]
  view: 'grid' | 'list'
  /** 채널 파일 탭이면 지정(자료실은 생략) */
  channelMode?: FilesBrowserChannelMode
}) {
  const panel = useRightPanel()
  const [previewId, setPreviewId] = useState<string | null>(null)

  const previewIndex = useMemo(
    () => (previewId ? items.findIndex(i => i.id === previewId) : -1),
    [items, previewId]
  )

  function select(item: FileListItem) {
    panel.open({
      key: `file:${item.id}`,
      title: '파일 상세',
      content: (
        <FileDetail
          item={item}
          onPreview={() => setPreviewId(item.id)}
          onNavigate={() => panel.close()}
        />
      ),
    })
  }

  const inChannel = Boolean(channelMode)
  // 표 열은 뷰포트가 아니라 표 영역의 폭(@container)으로 숨긴다 — 파일 상세 패널(360px)을 열면 뷰포트가 1280px 여도 목록은 600px 안팎이라,
  // 뷰포트 기준(sm:·md:)이면 폴더 열이 한 글자씩 세로로 꺾이며 행이 아주 높아졌다. 폴더·채널 열은 최소 폭(min-w-24)+말줄임.
  // 폴더 탐색 중(검색 아님)이면 직속 파일은 모두 같은 폴더라 "폴더" 열이 군더더기 — 숨긴다
  const hideFolderCol = Boolean(
    channelMode &&
      !channelMode.search.q &&
      items.every(i => i.folder_path === items[0]?.folder_path)
  )
  const sortHeader = (key: ChannelFileSortKey, label: string) => {
    if (!channelMode) return label
    const { search } = channelMode
    const active = search.sort === key
    const nextDir = active
      ? search.dir === 'asc'
        ? 'desc'
        : 'asc'
      : key === 'name'
        ? 'asc'
        : 'desc'
    return (
      <Link
        href={modeHref(channelMode, { ...search, sort: key, dir: nextDir, page: 1 })}
        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:underline"
      >
        {label}
        {active &&
          (search.dir === 'asc' ? (
            <ArrowUpIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <ArrowDownIcon aria-hidden="true" className="size-3.5" />
          ))}
      </Link>
    )
  }
  const ariaSort = (key: ChannelFileSortKey) =>
    channelMode?.search.sort === key
      ? channelMode.search.dir === 'asc'
        ? ('ascending' as const)
        : ('descending' as const)
      : undefined

  return (
    <>
      {view === 'grid' && !inChannel ? (
        <ul aria-label="파일 목록" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => select(item)}
                aria-label={`${item.name} 상세 보기`}
                className="flex w-full flex-col overflow-hidden rounded-w-lg border bg-card text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex aspect-[4/3] items-center justify-center bg-muted">
                  {isBrowserImage(item.mime, item.name) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(item.id, { thumb: true })}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <FileIcon
                      mime={item.mime}
                      name={item.name}
                      size={item.size}
                      className="size-10"
                    />
                  )}
                </span>
                <span className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium" title={item.name}>
                      {item.name}
                    </span>
                    <VersionNumberBadge versionNo={item.version_no} />
                    {item.is_latest === false && <OldVersionBadge />}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {channelLabel(item)} · {formatBytes(item.size)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <DataTable caption="파일 목록" className="@container">
          <THead>
            <Th aria-sort={ariaSort('name')}>{sortHeader('name', '이름')}</Th>
            {!hideFolderCol && (
              <Th className="hidden min-w-24 whitespace-nowrap @2xl:table-cell">
                {inChannel ? '폴더' : '채널'}
              </Th>
            )}
            <Th className="hidden @2xl:table-cell">올린 사람</Th>
            <Th className="hidden @lg:table-cell">형식</Th>
            <Th numeric aria-sort={ariaSort('size')}>
              {sortHeader('size', '크기')}
            </Th>
            <Th
              aria-sort={ariaSort('date')}
              className={cn('hidden', inChannel ? '@lg:table-cell' : '@4xl:table-cell')}
            >
              {sortHeader('date', '올린 날짜')}
            </Th>
          </THead>
          <TBody>
            {channelMode?.folders.map(folder => (
              <Tr key={`folder:${folder.path}`} interactive>
                <Td colSpan={6}>
                  <Link
                    href={modeHref(channelMode, {
                      ...channelMode.search,
                      path: folder.path,
                      q: undefined,
                      page: 1,
                    })}
                    className="flex items-center gap-2 font-medium outline-none hover:underline focus-visible:underline"
                  >
                    <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 break-all">{folder.name}</span>
                    {/* 폴더 수는 최신 버전만 센다(0032) — 이전 버전까지 보는 보기에서는 목록과 어긋나 숨긴다 */}
                    {channelMode.search.versions !== 'all' && (
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        파일 {folder.fileCount.toLocaleString('ko-KR')}개
                      </span>
                    )}
                  </Link>
                </Td>
              </Tr>
            ))}
            {items.map(item => (
              <Tr key={item.id} interactive>
                <Td className="min-w-48">
                  <button
                    type="button"
                    onClick={() => select(item)}
                    aria-label={`${item.name} 상세 보기`}
                    className={cn(
                      'flex w-full items-start gap-2 text-left outline-none focus-visible:underline'
                    )}
                  >
                    <FileIcon
                      mime={item.mime}
                      name={item.name}
                      size={item.size}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="min-w-0 font-medium break-all">{item.name}</span>
                    <VersionNumberBadge versionNo={item.version_no} />
                    {item.is_latest === false && <OldVersionBadge />}
                  </button>
                </Td>
                {!hideFolderCol && (
                  <Td className="hidden max-w-48 min-w-24 @2xl:table-cell">
                    {channelMode ? (
                      item.folder_path ? (
                        <Link
                          href={modeHref(channelMode, { path: item.folder_path })}
                          title={item.folder_path}
                          className="block truncate hover:underline focus-visible:underline"
                        >
                          {item.folder_path}
                        </Link>
                      ) : (
                        '-'
                      )
                    ) : (
                      <span className="block truncate" title={channelLabel(item)}>
                        {channelLabel(item)}
                      </span>
                    )}
                  </Td>
                )}
                <Td className="hidden @2xl:table-cell">{item.staff?.display_name ?? '-'}</Td>
                <Td className="hidden @lg:table-cell">
                  {FILE_KIND_LABEL[fileKindOf(item.mime, item.name, item.size)]}
                </Td>
                <Td numeric>{formatBytes(item.size)}</Td>
                <Td
                  nowrap
                  className={cn('hidden', inChannel ? '@lg:table-cell' : '@4xl:table-cell')}
                >
                  {formatDateTime(item.created_at)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      )}

      <FilePreviewDialog
        files={items}
        index={previewIndex >= 0 ? previewIndex : null}
        onIndexChange={i => setPreviewId(items[i]?.id ?? null)}
        onClose={() => setPreviewId(null)}
      />
    </>
  )
}
