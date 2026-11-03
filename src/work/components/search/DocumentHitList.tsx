'use client'

import { useMemo, useState } from 'react'
import Link from '@work/lib/nav/link'
import { MessageSquareIcon } from 'lucide-work'
import FileIcon from '@work/components/files/FileIcon'
import FilePreviewDialog from '@work/components/files/FilePreviewDialog'
import { formatDateTime } from '@work/lib/format/datetime'
import { formatBytes } from '@work/lib/search/format'
import type { DocumentHit } from '@work/lib/search/search'
import ChannelLabel from './ChannelLabel'
import Highlight from './Highlight'

/**
 * "문서 내용" 결과 — 파일명 + 일치 부분 스니펫(평문, Highlight 로만 그림) + 채널.
 * 제목을 누르면 그 자리에서 미리보기(DocumentViewer 등)를 열고, "대화에서 보기"로 메시지에 갈 수 있다.
 */
export default function DocumentHitList({
  hits,
  terms,
  nowMs,
  labelledBy,
}: {
  hits: DocumentHit[]
  terms: string[]
  /** 서버 렌더와 같은 "오늘" 기준(하이드레이션 불일치 방지) */
  nowMs?: number
  labelledBy?: string
}) {
  const [index, setIndex] = useState<number | null>(null)
  const files = useMemo(
    () => hits.map(h => ({ id: h.id, name: h.name, mime: h.mime, size: h.size })),
    [hits]
  )
  const now = nowMs === undefined ? undefined : new Date(nowMs)

  return (
    <>
      <ul aria-labelledby={labelledBy} className="divide-y overflow-hidden rounded-w-lg border">
        {hits.map((h, i) => (
          <li key={h.id} className="px-4 py-3">
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-haspopup="dialog"
              className="flex w-full items-center gap-2 rounded-w-lg text-left text-sm outline-none hover:underline"
            >
              <FileIcon mime={h.mime} name={h.name} size={h.size} className="size-4 shrink-0" />
              <span className="min-w-0 break-all">
                <Highlight text={h.name} terms={terms} />
              </span>
              {h.oldVersionNo !== undefined && (
                <span className="shrink-0 rounded-w-lg border px-1 text-xs text-muted-foreground">
                  이전 버전 v{h.oldVersionNo}
                </span>
              )}
              <span className="sr-only"> 미리보기 열기</span>
            </button>
            <p className="mt-1 text-sm break-words text-muted-foreground">
              <Highlight text={h.snippet} terms={terms} />
            </p>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <ChannelLabel channel={h.channel} />
              <span>{formatBytes(h.size)}</span>
              <time dateTime={h.createdAt}>{formatDateTime(h.createdAt, now)}</time>
              <Link
                href={h.href}
                className="inline-flex items-center gap-1 rounded-w-lg underline outline-none hover:text-foreground"
              >
                <MessageSquareIcon aria-hidden="true" className="size-3.5" />
                대화에서 보기
              </Link>
            </span>
          </li>
        ))}
      </ul>
      <FilePreviewDialog
        files={files}
        index={index}
        onIndexChange={setIndex}
        onClose={() => setIndex(null)}
      />
    </>
  )
}
