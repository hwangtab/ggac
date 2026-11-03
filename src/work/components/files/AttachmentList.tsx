'use client'

import { useMemo, useState } from 'react'
import { DownloadIcon } from 'lucide-work'
import { formatBytes, isBrowserImage, previewKindOf } from '@work/lib/files/mime'
import type { Attachment } from '@work/lib/files/schema'
import { cn } from '@work/lib/utils'
import FileIcon from './FileIcon'
import FilePreviewDialog, { fileUrl } from './FilePreviewDialog'
import { OldVersionBadge, VersionNumberBadge } from './versions/VersionBadges'

/**
 * 메시지 본문 아래에 첨부를 그린다. 이미지는 썸네일 그리드(클릭 → 라이트박스),
 * 그 밖의 파일은 아이콘 + 이름 + 크기 행(미리보기 가능한 형식 — PDF·HWP·HWPX·DOCX·XLSX·XLS·텍스트 — 은
 * 클릭 → 미리보기, 나머지는 다운로드).
 */
export default function AttachmentList({
  attachments,
  className,
}: {
  attachments: Attachment[]
  className?: string
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const previewables = useMemo(
    // 화면 순서(이미지 그리드 → 파일 행)와 같게 — 라이트박스 이전·다음이 보이는 순서를 따른다
    () =>
      [
        ...attachments.filter(a => isBrowserImage(a.mime)),
        ...attachments.filter(a => !isBrowserImage(a.mime)),
      ].filter(a => previewKindOf(a.mime, a.name, a.size) !== null),
    [attachments]
  )
  const images = attachments.filter(a => isBrowserImage(a.mime, a.name))
  const others = attachments.filter(a => !isBrowserImage(a.mime, a.name))

  if (attachments.length === 0) return null

  const openPreview = (id: string) => {
    const idx = previewables.findIndex(a => a.id === id)
    if (idx >= 0) setPreviewIndex(idx)
  }

  return (
    <div className={cn('mt-1.5 flex flex-col gap-1.5', className)}>
      {images.length > 0 && (
        <ul aria-label="첨부 이미지" className="flex flex-wrap gap-1.5">
          {images.map(a => (
            <li key={a.id} className="relative">
              <button
                type="button"
                onClick={() => openPreview(a.id)}
                aria-label={`${a.name} 크게 보기`}
                className="block overflow-hidden rounded-w-lg border bg-subtle outline-none"
              >
                {/* 서명 URL 로 302 되는 보호된 이미지 — next/image 최적화 대상 아님 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(a.id, { thumb: true })}
                  alt={a.name}
                  loading="lazy"
                  width={a.width ?? undefined}
                  height={a.height ?? undefined}
                  className="max-h-48 max-w-full object-cover sm:max-w-xs"
                />
              </button>
              {a.is_latest === false && (
                <span className="pointer-events-none absolute top-1 left-1">
                  <OldVersionBadge />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <ul aria-label="첨부 파일" className="flex flex-col gap-1">
          {others.map(a => {
            const canPreview = previewKindOf(a.mime, a.name, a.size) !== null
            return (
              <li
                key={a.id}
                className="flex max-w-md items-center gap-2 rounded-w-lg border bg-card px-2.5 py-1.5 text-sm"
              >
                <FileIcon mime={a.mime} name={a.name} size={a.size} />
                {canPreview ? (
                  <button
                    type="button"
                    onClick={() => openPreview(a.id)}
                    className="min-w-0 flex-1 truncate text-left font-medium hover:underline focus-visible:underline"
                  >
                    {a.name}
                  </button>
                ) : (
                  <a
                    href={fileUrl(a.id, { download: true })}
                    download={a.name}
                    className="min-w-0 flex-1 truncate font-medium hover:underline focus-visible:underline"
                  >
                    {a.name}
                  </a>
                )}
                <VersionNumberBadge versionNo={a.version_no} />
                {a.is_latest === false && <OldVersionBadge />}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(a.size)}
                </span>
                <a
                  href={fileUrl(a.id, { download: true })}
                  download={a.name}
                  aria-label={`${a.name} 다운로드`}
                  className="shrink-0 rounded-w-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <DownloadIcon aria-hidden="true" className="size-4" />
                </a>
              </li>
            )
          })}
        </ul>
      )}

      <FilePreviewDialog
        files={previewables}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(null)}
      />
    </div>
  )
}
