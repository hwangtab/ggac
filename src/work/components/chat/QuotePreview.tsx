'use client'

import { QuoteIcon, XIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { quotePreviewLines } from '@work/lib/messages/quote'

/**
 * 입력창 위 인용 미리보기 — 작성자와 본문 앞 2줄. 취소하면 인용 없이 보낸다.
 * 입력창 카드 안(첨부 미리보기와 같은 자리)에 들어간다.
 */
export default function QuotePreview({
  authorName,
  body,
  onCancel,
}: {
  authorName: string
  body: string
  onCancel: () => void
}) {
  const { lines, truncated } = quotePreviewLines(body)
  return (
    <div
      role="group"
      aria-label={`${authorName}의 메시지를 인용 중`}
      className="flex items-start gap-2 border-b px-3 py-2 text-xs"
    >
      <QuoteIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 border-l-2 border-primary pl-2">
        <p className="font-semibold">{authorName}에게 답장</p>
        {lines.length > 0 ? (
          <p className="text-muted-foreground">
            {lines.map((l, i) => (
              <span key={i} className="block truncate">
                {l}
                {truncated && i === lines.length - 1 ? '…' : ''}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground">(첨부 메시지)</p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onCancel}
        aria-label="인용 취소"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  )
}
