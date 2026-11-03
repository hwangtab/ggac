'use client'

import { useState } from 'react'
import { DownloadIcon, ExternalLinkIcon, FileXIcon } from 'lucide-work'
import FileIcon from '@work/components/files/FileIcon'
import FilePreviewBody, { fileUrl, namedFileUrl } from '@work/components/files/FilePreviewBody'
import FilePreviewDialog from '@work/components/files/FilePreviewDialog'
import FileVersionControls from '@work/components/files/versions/FileVersionControls'
import { VersionNumberBadge } from '@work/components/files/versions/VersionBadges'
import { EmptyState, SectionHeading } from '@work/components/layout/page'
import { buttonVariants } from '@work/components/ui/button'
import { formatDateTime } from '@work/lib/format/datetime'
import { FILE_KIND_LABEL, fileKindOf, formatBytes } from '@work/lib/files/mime'
import type { FileTabAttachment } from '@work/lib/tabs/queries'
import { cn } from '@work/lib/utils'

/**
 * 파일 탭 본문(docs/05 §4-1). 위에 파일 정보 줄(이름·종류·크기·올린 날·내려받기·새 창), 아래에 형식별 뷰어,
 * 맨 아래에 "이전 버전" 목록(config.history). 가리키던 첨부가 지워지면(메시지 소프트 삭제) 안내만 보인다.
 */
export default function FileTabView({
  current,
  history,
}: {
  current: FileTabAttachment | null
  history: FileTabAttachment[]
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const openable = history.filter(h => !h.deleted)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {current && !current.deleted ? (
        <>
          <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
            <FileIcon mime={current.mime} name={current.name} size={current.size} />
            {/* min-w-40: 이름이 버튼 옆에서 50~70px 로 눌리지 않게 — 모자라면 버튼 묶음이 아래 줄로 내려간다 */}
            <div className="min-w-40 flex-1">
              <p className="truncate text-sm font-medium">{current.name}</p>
              <p className="text-xs text-muted-foreground">
                {FILE_KIND_LABEL[fileKindOf(current.mime, current.name, current.size)]} ·{' '}
                {formatBytes(current.size)} · {formatDateTime(current.createdAt)} 올림
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={namedFileUrl(current.id, current.name)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <ExternalLinkIcon aria-hidden="true" />새 창에서 열기
              </a>
              <a
                href={fileUrl(current.id, { download: true })}
                download={current.name}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <DownloadIcon aria-hidden="true" />
                내려받기
              </a>
            </div>
          </div>
          <FileVersionControls
            key={current.id}
            attachmentId={current.id}
            fileName={current.name}
            className="shrink-0 border-b px-4 py-2"
          />
          <div className="relative min-h-0 flex-1 overflow-hidden bg-subtle">
            <FilePreviewBody key={current.id} file={current} padded downloadVerb="내려받아" />
          </div>
        </>
      ) : (
        <EmptyState
          icon={FileXIcon}
          as="p"
          title="원본 파일이 삭제됐습니다"
          description={
            history.some(h => !h.deleted)
              ? '아래 이전 버전에서 파일을 열 수 있습니다. 탭 메뉴의 “새 버전 올리기”로 새 파일을 올릴 수도 있습니다.'
              : '탭을 제거하거나, 탭 메뉴의 “새 버전 올리기”로 새 파일을 올려 주세요.'
          }
        />
      )}

      {history.length > 0 && (
        <section
          aria-label="이전 버전"
          className="max-h-48 shrink-0 overflow-y-auto border-t px-4 py-2"
        >
          <SectionHeading className="mb-1">이전 버전 {history.length}개</SectionHeading>
          <ul className="grid gap-1">
            {history.map(h => {
              const idx = openable.findIndex(o => o.id === h.id)
              return (
                <li
                  key={h.id}
                  className={cn(
                    'flex min-h-10 flex-wrap items-center gap-2 rounded-w-lg px-2 text-sm',
                    h.deleted && 'text-muted-foreground'
                  )}
                >
                  <FileIcon mime={h.mime} name={h.name} size={h.size} className="size-4" />
                  <span className="min-w-32 flex-1 truncate">{h.name}</span>
                  {h.versionNo !== undefined && <VersionNumberBadge versionNo={h.versionNo} />}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(h.size)} · {formatDateTime(h.createdAt)}
                  </span>
                  {h.deleted ? (
                    <span className="shrink-0 text-xs">삭제됨</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        aria-label={`이전 버전 ${h.name} 열기`}
                        onClick={() => setPreviewIndex(idx)}
                      >
                        열기
                      </button>
                      <a
                        href={fileUrl(h.id, { download: true })}
                        download={h.name}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        aria-label={`이전 버전 ${h.name} 내려받기`}
                      >
                        내려받기
                      </a>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <FilePreviewDialog
        files={openable}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(null)}
      />
    </div>
  )
}
