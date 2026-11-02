import Link from '@work/lib/nav/link'
import { CornerDownRightIcon, ForwardIcon } from 'lucide-work'
import { messageAnchor, messageLink } from '@work/lib/messages/anchor'
import {
  QUOTE_DELETED_TEXT,
  QUOTE_UNAVAILABLE_TEXT,
  quotePreviewLines,
  quoteState,
} from '@work/lib/messages/quote'
import type { ChatMessage } from '@work/lib/messages/types'
import { cn } from '@work/lib/utils'

const CARD =
  'mt-0.5 mb-1 flex max-w-prose items-start gap-2 rounded-w-md border-l-2 bg-muted/50 px-2.5 py-1.5 text-xs'

/**
 * 메시지 위 인용 카드(0028). 원본을 볼 수 있으면 작성자·앞 2줄 + `#msg-<id>` 앵커 링크,
 * 삭제됐거나 읽을 수 없으면(권한 없음·하드 삭제) 안내 문구만 보인다.
 * `base`(`/c/<slug>` · `/dm/<id>`)는 스레드 답글을 인용했을 때 ?thread= 링크를 만드는 데 쓴다.
 */
export function QuoteCard({
  message,
  nameOf,
  base,
}: {
  message: Pick<ChatMessage, 'quoted_message_id' | 'quoted' | 'channel_id'>
  nameOf: (userId: string | null) => string
  base?: string
}) {
  const state = quoteState(message)
  if (state === 'none') return null
  if (state !== 'ok' || !message.quoted) {
    return (
      <p className={cn(CARD, 'border-border text-muted-foreground italic')}>
        <CornerDownRightIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {state === 'deleted' ? QUOTE_DELETED_TEXT : QUOTE_UNAVAILABLE_TEXT}
      </p>
    )
  }
  const quoted = message.quoted
  const author = nameOf(quoted.author_id)
  const { lines, truncated } = quotePreviewLines(quoted.body)
  // 스레드 답글이면 부모 스레드를 열어야 하므로 ?thread= 링크, 아니면 같은 화면의 해시 앵커(hashchange 로 이동·강조)
  const href =
    quoted.parent_id && base
      ? `${base}?thread=${quoted.parent_id}#${messageAnchor(quoted.id)}`
      : `#${messageAnchor(quoted.id)}`
  const content = (
    <>
      <CornerDownRightIcon
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{author}</span>
        {lines.map((l, i) => (
          <span key={i} className="block truncate text-muted-foreground">
            {l}
            {truncated && i === lines.length - 1 ? '…' : ''}
          </span>
        ))}
      </span>
    </>
  )
  const className = cn(
    CARD,
    'border-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'
  )
  return quoted.parent_id && base ? (
    <Link href={href} aria-label={`${author}의 인용된 메시지로 이동`} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} aria-label={`${author}의 인용된 메시지로 이동`} className={className}>
      {content}
    </a>
  )
}

/**
 * 전달 메시지 표시(0028) — 본문(코멘트 + 복사된 원문)은 마크다운으로 그려지고, 여기서는 원문 링크만 붙인다.
 * 원본을 읽을 수 없으면(권한 없음·삭제) "볼 수 없음".
 */
export function ForwardedNote({
  message,
}: {
  message: Pick<ChatMessage, 'forwarded_from_id' | 'forwarded'>
}) {
  if (!message.forwarded_from_id) return null
  const f = message.forwarded
  if (!f || f.deleted_at) {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground italic">
        <ForwardIcon aria-hidden="true" className="size-3.5" />
        원본 메시지를 볼 수 없습니다
      </p>
    )
  }
  const href = messageLink({
    channelId: f.channel_id,
    kind: f.channel?.kind,
    slug: f.channel?.slug,
    messageId: f.id,
    parentId: f.parent_id,
  })
  return (
    <p className="mt-0.5 text-xs">
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ForwardIcon aria-hidden="true" className="size-3.5" />
        원문 보기
      </Link>
    </p>
  )
}
