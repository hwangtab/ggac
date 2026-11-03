import React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { remarkTrimAutolinks } from '@work/lib/markdown/autolink'
import { cn } from '@work/lib/utils'

/**
 * 메시지 본문 마크다운 렌더(kosmartweb PostMarkdown 의 'ugc' 경로를 업무툴용으로 정리).
 *
 * - raw HTML 은 렌더하지 않는다(skipHtml, rehype-raw 금지, dangerouslySetInnerHTML 금지).
 * - 링크는 http/https/mailto/tel·상대경로만. 외부 링크는 새 탭 + noopener noreferrer.
 * - 본문 안 이미지 문법(`![](url)`)은 불러오지 않는다 — 외부 이미지는 열람자 IP·UA 를 새게 하는
 *   추적 픽셀이 된다. 이미지는 첨부(work.attachments, 서명 URL)로만 보인다.
 * - 저장 단계 정제는 src/lib/markdown/sanitize-markdown.ts(sanitizeUserMarkdown).
 */
export function isSafeHref(href: string | undefined): href is string {
  if (!href) return false
  const trimmed = href.trim()
  if (trimmed === '') return false
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!schemeMatch) return true
  const scheme = schemeMatch[1].toLowerCase()
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel'
}

// 렌더마다 새 객체를 만들면 하위 트리가 리마운트되므로 모듈 상수로 둔다.
const COMPONENTS: Components = {
  img({ alt }) {
    return alt ? <span className="text-muted-foreground">[이미지: {alt}]</span> : null
  },
  a({ href, children }) {
    if (!isSafeHref(href)) return <>{children}</>
    if (/^https?:/i.test(href.trim()) || href.trim().startsWith('//')) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
          {children}
        </a>
      )
    }
    return <a href={href}>{children}</a>
  },
}

export default function MessageMarkdown({
  content,
  className,
  components,
}: {
  content: string
  className?: string
  /** 기본 렌더러 위에 덧씌울 요소(예: 메모 표 행 편집). 호출 쪽에서 메모이즈해 넘긴다. */
  components?: Components
}) {
  return (
    <div
      className={cn(
        'post-markdown prose prose-sm max-w-none text-sm leading-6 prose-p:my-0 prose-p:leading-6 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-blockquote:my-1',
        className
      )}
    >
      <ReactMarkdown
        // singleTilde:false — "1만~2만원" 같은 범위 표기가 취소선으로 오인되지 않게
        // remarkCjkFriendly — CJK 문장부호 뒤 한글 조사에서 ** 가 닫히지 않는 문제 교정
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          remarkCjkFriendly,
          remarkTrimAutolinks,
        ]}
        skipHtml
        components={components ? { ...COMPONENTS, ...components } : COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
