'use client'

import { AlertCircleIcon, CheckIcon, PauseIcon, PlayIcon, RotateCwIcon, XIcon } from 'lucide-work'
import { MAX_FILE_BYTES } from '@work/lib/files/schema'
import { formatBytes } from '@work/lib/files/mime'
import { cn } from '@work/lib/utils'
import FileIcon from './FileIcon'
import type { AttachmentUploads } from './useAttachmentUploads'

const ICON_BTN =
  'shrink-0 rounded-w-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground'

/**
 * 전송 전 첨부 목록(진행률·제거·총량). MessageComposer 의 attachmentsSlot 에 넣는다.
 * 첨부가 없고 오류도 없으면 아무것도 그리지 않는다.
 */
export default function PendingAttachments({
  uploads,
  className,
}: {
  uploads: AttachmentUploads
  className?: string
}) {
  const { items, totalBytes, error, removeItem, pauseItem, resumeItem, retryItem } = uploads
  if (items.length === 0 && !error) return null

  return (
    <div className={cn('flex flex-col gap-1.5 px-2 pt-2', className)}>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <>
          <ul aria-label="첨부할 파일" className="flex flex-col gap-1">
            {items.map(it => {
              const percent = Math.round(it.progress * 100)
              return (
                <li
                  key={it.localId}
                  className="flex items-center gap-2 rounded-w-lg border bg-subtle px-2 py-1 text-sm"
                >
                  <FileIcon mime={it.mime} name={it.name} size={it.size} className="size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate">{it.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(it.size)}
                      </span>
                    </div>
                    {(it.status === 'uploading' || it.status === 'paused') && (
                      <div
                        role="progressbar"
                        aria-label={`${it.name} 업로드 진행률`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        className="mt-1 h-1 overflow-hidden rounded-w-lg bg-border"
                      >
                        <div
                          className="h-full bg-primary transition-[width]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                    {it.resumable && (it.status === 'uploading' || it.status === 'paused') && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {it.status === 'paused' ? '일시정지됨' : '이어 올리기'} · {percent}%
                        {it.status === 'uploading' && ' (끊겨도 이어서 올립니다)'}
                      </p>
                    )}
                    {it.status === 'error' && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircleIcon aria-hidden="true" className="size-3" />
                        {it.error ?? '업로드하지 못했습니다.'}
                      </p>
                    )}
                  </div>
                  {it.status === 'done' && (
                    <CheckIcon aria-label="업로드 완료" className="size-4 shrink-0 text-primary" />
                  )}
                  {it.resumable && it.status === 'uploading' && (
                    <button
                      type="button"
                      onClick={() => pauseItem(it.localId)}
                      aria-label={`${it.name} 업로드 일시정지`}
                      className={ICON_BTN}
                    >
                      <PauseIcon aria-hidden="true" className="size-4" />
                    </button>
                  )}
                  {it.resumable && it.status === 'paused' && (
                    <button
                      type="button"
                      onClick={() => resumeItem(it.localId)}
                      aria-label={`${it.name} 업로드 계속`}
                      className={ICON_BTN}
                    >
                      <PlayIcon aria-hidden="true" className="size-4" />
                    </button>
                  )}
                  {it.resumable && it.status === 'error' && (
                    <button
                      type="button"
                      onClick={() => retryItem(it.localId)}
                      aria-label={`${it.name} 업로드 다시 시도`}
                      className={ICON_BTN}
                    >
                      <RotateCwIcon aria-hidden="true" className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(it.localId)}
                    aria-label={`${it.name} 첨부 제거`}
                    className={ICON_BTN}
                  >
                    <XIcon aria-hidden="true" className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            총 {formatBytes(totalBytes)} · 파일당 최대 {formatBytes(MAX_FILE_BYTES)}
          </p>
        </>
      )}
    </div>
  )
}
