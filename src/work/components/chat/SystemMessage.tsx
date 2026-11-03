'use client'

import { useId, useState } from 'react'
import Link from '@work/lib/nav/link'
import { ChevronDownIcon, ChevronRightIcon, FolderOpenIcon } from 'lucide-work'
import AttachmentList from '@work/components/files/AttachmentList'
import MessageMarkdown from '@work/components/markdown/MessageMarkdown'
import { channelFilesHref } from '@work/lib/files/channel-files'
import { formatClock } from '@work/lib/messages/format'
import { cn } from '@work/lib/utils'
import type { ChatMessage } from '@work/lib/messages/types'

/**
 * 시스템 메시지(그룹 추가·나가기, 파일 이관 등). 가운데 작은 회색 한 줄 — 본문은 마크다운으로 그린다
 * (이관 메시지의 `**폴더**` 강조; raw HTML 은 렌더하지 않는다).
 * 첨부가 있으면(이관) "파일 N개 보기"로 접힌 첨부 목록을 펼치고, 폴더가 있으면 파일 탭의 그 폴더로 가는 링크를 준다.
 */
export default function SystemMessage({
  message,
  anchor = false,
  filesBase,
  highlighted = false,
}: {
  message: ChatMessage
  anchor?: boolean
  /** `/c/<slug>` 또는 `/dm/<id>` — 파일 탭 링크의 기준. 없으면 링크를 그리지 않는다 */
  filesBase?: string
  /** 앵커로 들어와 잠깐 강조 */
  highlighted?: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const attachments = message.attachments
  const folder = attachments.find(a => a.folder_path)?.folder_path ?? null
  // 이관 메시지(첨부 있음)는 폴더 경로가 길어 가운데 정렬 한 줄로는 읽기 어렵다 — 왼쪽 정렬 상자로 그린다(docs/13 §5)
  const boxed = attachments.length > 0
  // 첨부가 하나면 "파일 1개 보기"를 누르게 하지 않고 바로 보여 준다
  const inline = attachments.length === 1

  return (
    <div
      id={anchor ? `msg-${message.id}` : undefined}
      className={cn(
        boxed
          ? 'mx-4 my-1 rounded-w-lg border bg-subtle px-3 py-2 text-left text-xs text-muted-foreground [overflow-wrap:anywhere]'
          : 'px-4 py-1 text-center text-xs text-muted-foreground',
        highlighted && 'bg-primary/10'
      )}
      data-message-id={message.id}
    >
      <MessageMarkdown
        content={message.body}
        className="inline !text-xs !leading-normal [--tw-prose-body:var(--muted-foreground)] [--tw-prose-bold:var(--muted-foreground)] [&_p]:inline"
      />
      <span> · {formatClock(message.created_at)}</span>

      {attachments.length > 0 && (
        <div className="mt-1 flex flex-col items-start gap-1">
          {inline && (
            <div className="w-full max-w-md">
              <AttachmentList attachments={attachments} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!inline && (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(v => !v)}
                className="inline-flex items-center gap-0.5 rounded-w-lg px-1 py-0.5 font-medium text-muted-foreground outline-none hover:text-foreground hover:underline"
              >
                {open ? (
                  <ChevronDownIcon aria-hidden="true" className="size-3.5" />
                ) : (
                  <ChevronRightIcon aria-hidden="true" className="size-3.5" />
                )}
                파일 {attachments.length}개 {open ? '접기' : '보기'}
              </button>
            )}
            {filesBase && folder && (
              <Link
                href={channelFilesHref(filesBase, { path: folder })}
                className="inline-flex items-center gap-1 rounded-w-lg px-1 py-0.5 font-medium text-primary outline-none hover:underline"
              >
                <FolderOpenIcon aria-hidden="true" className="size-3.5" />
                파일 탭에서 이 폴더 열기
              </Link>
            )}
          </div>
          {!inline && (
            <div id={panelId} hidden={!open} className="w-full max-w-md">
              {open && <AttachmentList attachments={attachments} />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
