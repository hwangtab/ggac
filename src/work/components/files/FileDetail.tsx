'use client'

import Link from '@work/lib/nav/link'
import {
  ChevronRightIcon,
  DownloadIcon,
  EyeIcon,
  FolderOpenIcon,
  MessageSquareIcon,
} from 'lucide-work'
import { chatKindLabel } from '@work/lib/channels/group'
import { channelFilesHref } from '@work/lib/files/channel-files'
import { formatDateTime } from '@work/lib/format/datetime'
import { FILE_KIND_LABEL, fileKindOf, formatBytes } from '@work/lib/files/mime'
import type { FileListItem } from '@work/lib/files/queries'
import { buttonVariants } from '@work/components/ui/button'
import { cn } from '@work/lib/utils'
import FileThumbnail from './FileThumbnail'
import FileVersionControls from './versions/FileVersionControls'
import { fileUrl } from './FilePreviewDialog'

/** 원본 메시지 링크. 채널은 /c/<slug>#msg-<id>, DM 은 /dm/<channel_id>#msg-<id>. */
export function messageHref(item: Pick<FileListItem, 'channel_id' | 'message_id' | 'channels'>) {
  const base = item.channels?.slug ? `/c/${item.channels.slug}` : `/dm/${item.channel_id}`
  return `${base}#msg-${item.message_id}`
}

/** 다른 화면으로 가는 바로 가기 행(아이콘 · 이름 · ›) */
const SHORTCUT_CLASS =
  'flex items-center gap-2 px-4 py-3 text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

/** 우측 패널(useRightPanel().open 의 content)에 들어가는 파일 상세. */
export default function FileDetail({
  item,
  onPreview,
  onNavigate,
}: {
  item: FileListItem
  onPreview: () => void
  /** "원본 메시지로 이동"을 누를 때(우측 패널 닫기 — 채널 화면에 파일 상세가 남지 않게, QA #15) */
  onNavigate?: () => void
}) {
  const kind = fileKindOf(item.mime, item.name, item.size)
  const rows: [string, string][] = [
    ['형식', `${FILE_KIND_LABEL[kind]} (${item.mime})`],
    ['크기', formatBytes(item.size)],
    ...(item.width && item.height
      ? ([['해상도', `${item.width} × ${item.height}`]] as [string, string][])
      : []),
    ['올린 사람', item.staff?.display_name ?? '탈퇴한 멤버'],
    ['올린 날짜', formatDateTime(item.created_at)],
    [
      '채널',
      item.channels
        ? item.channels.kind === 'dm'
          ? chatKindLabel(item.channels.name)
          : `# ${item.channels.name}`
        : '-',
    ],
    ...(item.folder_path ? ([['폴더', item.folder_path]] as [string, string][]) : []),
  ]

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-w-lg border bg-muted">
        <FileThumbnail key={item.id} file={item} />
      </div>

      <h3 className="text-sm font-semibold break-all">{item.name}</h3>

      {/* 층위: 주 동작(미리보기·다운로드, 기본 크기 두 칸) → 편집·버전(작은 외곽선) → 정보 → 다른 화면 바로 가기 */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onPreview}
          aria-label={`${item.name} 미리보기`}
          className={cn(buttonVariants({ variant: 'default' }), 'w-full')}
        >
          <EyeIcon aria-hidden="true" />
          미리보기
        </button>
        <a
          href={fileUrl(item.id, { download: true })}
          download={item.name}
          aria-label={`${item.name} 다운로드`}
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        >
          <DownloadIcon aria-hidden="true" />
          다운로드
        </a>
      </div>

      <FileVersionControls key={item.id} attachmentId={item.id} fileName={item.name} subdued />

      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>

      <ul
        aria-label="바로 가기"
        className="flex flex-col divide-y overflow-hidden rounded-w-lg border"
      >
        <li>
          <Link href={messageHref(item)} onClick={onNavigate} className={SHORTCUT_CLASS}>
            <MessageSquareIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">원본 메시지로 이동</span>
            <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </Link>
        </li>
        {item.folder_path && (
          <li>
            <Link
              href={channelFilesHref(
                item.channels?.slug ? `/c/${item.channels.slug}` : `/dm/${item.channel_id}`,
                { path: item.folder_path }
              )}
              onClick={onNavigate}
              className={SHORTCUT_CLASS}
            >
              <FolderOpenIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">채널 파일 탭에서 폴더 열기</span>
              <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </Link>
          </li>
        )}
      </ul>
    </div>
  )
}
