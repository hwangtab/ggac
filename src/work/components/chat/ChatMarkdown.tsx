import React, { useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { isSafeHref } from '@work/components/markdown/MessageMarkdown'
import { parseMentionHref, toRenderMarkdown } from '@work/lib/messages/mentions'
import { remarkTrimAutolinks } from '@work/lib/markdown/autolink'
import { cn } from '@work/lib/utils'

/**
 * 채팅 본문 렌더 — MessageMarkdown 과 같은 규칙(raw HTML 비렌더·링크 allowlist·본문 이미지 차단)에
 * 멘션 하이라이트만 더한다. MessageMarkdown 은 components 를 받지 않고, react-markdown 의 기본
 * urlTransform 이 `user:` 스킴을 지워 버려서 별도 컴포넌트로 둔다.
 *
 * 멘션 토큰 `@[이름](user:<uuid>)` 과 `@channel` 은 toRenderMarkdown 이 (무작위 스킴의) 링크 문법으로 바꾸고,
 * 여기서 그 링크만 하이라이트 <span> 으로 그린다(클릭 가능한 링크가 아니다). 본문에 직접 쓴
 * `[글](mention:channel)`·`[@이름](user:<uuid>)` 는 멘션이 아니다 — 일반 링크 규칙을 탄다.
 *
 * 멘션 토큰의 이름은 작성자가 아무렇게나 쓸 수 있다(`@[대표이사](user:<남의 id>)`). 글자는 토큰의 이름이 아니라
 * members 에서 id 로 찾은 실제 이름으로만 그리고, 목록에 없으면(members 가 없을 때도) "알 수 없는 사용자"로 그린다.
 */

/** 멘션 이름 조회용 채널 멤버(id → 표시 이름) */
export type MentionMember = { id: string; name: string }

export const UNKNOWN_MENTION_NAME = '알 수 없는 사용자'

/**
 * 채팅 본문 타이포그래피(QA #20). typography 플러그인 기본값 중 채팅에 어색한 것을 끈다.
 * - 인라인 코드 앞뒤에 붙는 백틱(`code::before/after { content: "`" }`) 제거, 옅은 배경 칩으로.
 * - 인용문 첫·끝 문단의 자동 따옴표(open-quote/close-quote)와 기울임 제거.
 * - 코드(블록·인라인) 글자 13px — prose-sm 기본(약 12px)은 작아서 읽기 어렵다.
 */
export const CHAT_PROSE_CLASS = cn(
  'prose-code:before:content-none prose-code:after:content-none',
  'prose-code:rounded-w-lg prose-code:bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-[13px]',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  'prose-pre:text-[13px] prose-pre:leading-relaxed',
  'prose-blockquote:font-normal prose-blockquote:not-italic',
  'before:[&_blockquote_p]:content-none after:[&_blockquote_p]:content-none'
)

// 멘션 링크(toRenderMarkdown 이 만든 무작위 스킴)만 통과시키고 나머지는 기본 규칙을 탄다 —
// 본문에 직접 쓴 user:·mention: 링크는 기본 규칙이 지워 일반 글자가 된다.
function urlTransform(url: string): string {
  if (parseMentionHref(url)) return url
  return defaultUrlTransform(url)
}

function makeComponents(
  me: string | undefined,
  names: ReadonlyMap<string, string> | null
): Components {
  return {
    img({ alt }) {
      return alt ? <span className="text-muted-foreground">[이미지: {alt}]</span> : null
    },
    a({ href, children }) {
      const mention = parseMentionHref(href)
      if (mention) {
        // 글자는 토큰에 쓴 글이 아니라 실제 이름(members)·고정 키워드로만 그린다 — 이름 위조 방지
        const isChannel = mention.kind === 'channel'
        const self = isChannel || mention.id === me?.toLowerCase()
        const label = isChannel ? '@channel' : `@${names?.get(mention.id) ?? UNKNOWN_MENTION_NAME}`
        return (
          <span
            data-mention={isChannel ? 'channel' : mention.id}
            className={cn(
              'rounded-w-lg px-0.5 font-medium',
              self ? 'bg-mention-solid text-mention-solid-foreground' : 'bg-primary/10 text-primary'
            )}
          >
            {label}
          </span>
        )
      }
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
    // GFM 표: 긴 셀이 메시지 목록 전체를 가로로 밀어내지 않게 표만 가로 스크롤(위키 WikiMarkdown 과 같은 방식)
    table({ children }) {
      return (
        // 가로로 스크롤되는 영역은 키보드로도 닿아야 한다(axe scrollable-region-focusable) — 원본 그대로
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="표">
          <table>{children}</table>
        </div>
      )
    },
  }
}

const COMPONENTS_ANON = makeComponents(undefined, null)
const cache = new Map<string, Components>()
function componentsFor(me: string | undefined): Components {
  if (!me) return COMPONENTS_ANON
  let c = cache.get(me)
  if (!c) {
    c = makeComponents(me, null)
    cache.set(me, c)
  }
  return c
}

export default function ChatMarkdown({
  content,
  me,
  members,
  className,
}: {
  content: string
  /** 현재 사용자 id — 나를 부른 멘션은 강조색을 달리한다 */
  me?: string
  /** 채널 멤버 — 주면 멘션 이름을 id 로 찾은 실제 이름으로 그린다(토큰 이름 위조 방지) */
  members?: readonly MentionMember[]
  className?: string
}) {
  const components = useMemo(
    () =>
      members
        ? makeComponents(me, new Map(members.map(m => [m.id.toLowerCase(), m.name])))
        : componentsFor(me),
    [me, members]
  )
  return (
    <div
      className={cn(
        'post-markdown prose prose-sm max-w-none break-words prose-p:my-0 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1',
        CHAT_PROSE_CLASS,
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          remarkCjkFriendly,
          remarkTrimAutolinks,
        ]}
        skipHtml
        urlTransform={urlTransform}
        components={components}
      >
        {toRenderMarkdown(content)}
      </ReactMarkdown>
    </div>
  )
}
