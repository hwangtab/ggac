import Link from '@work/lib/nav/link'
import { ExternalLinkIcon } from 'lucide-work'
import { formatDateTime } from '@work/lib/format/datetime'
import { linkHost, linkPathLabel, type LinkItem } from '@work/lib/tabs/links'

/**
 * 이 대화에서 공유된 링크 목록(서버 컴포넌트, docs/05 §5). 주소는 항상 새 창 + noopener noreferrer,
 * 공유한 사람·시각과 "메시지로 이동"을 붙인다. 표시 주소는 호스트 + 짧은 경로(전체 주소는 title).
 * 주소는 DB 트리거가 http(s) 로 시작하는 것만 모아 두므로 다른 스킴은 올 수 없지만, 여기서도 한 번 거른다.
 */
export default function LinkList({ items, now }: { items: LinkItem[]; now?: Date }) {
  const safe = items.filter(l => /^https?:\/\//i.test(l.url))
  return (
    <ul aria-label="공유된 링크" className="divide-y rounded-w-lg border">
      {safe.map(l => (
        <li
          key={`${l.messageId}:${l.url}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
        >
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            data-tooltip={l.url}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm outline-none hover:underline"
          >
            <ExternalLinkIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 break-all">
              <span className="font-medium">{linkHost(l.url) || l.url}</span>
              <span className="text-muted-foreground">{linkPathLabel(l.url)}</span>
              <span className="sr-only"> (새 창)</span>
            </span>
          </a>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {l.authorName && <span>{l.authorName}</span>}
            <time dateTime={l.createdAt}>{formatDateTime(l.createdAt, now)}</time>
            <Link
              href={l.messageHref}
              className="text-foreground underline outline-none"
              aria-label={`${linkHost(l.url) || '링크'} 가 든 메시지로 이동`}
            >
              메시지로 이동
            </Link>
          </span>
        </li>
      ))}
    </ul>
  )
}
