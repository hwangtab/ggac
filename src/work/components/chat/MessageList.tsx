'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ArrowDownIcon, Loader2Icon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { messageAnchor, messageIdFromHash } from '@work/lib/messages/anchor'
import { formatDayDivider } from '@work/lib/messages/format'
import { buildTimelineItems } from '@work/lib/messages/timeline'
import type { ChatMessage } from '@work/lib/messages/types'
import type { MentionMember } from './ChatMarkdown'
import MessageItem, { type MessageItemHandlers } from './MessageItem'

const BOTTOM_THRESHOLD_PX = 80
const TOP_LOAD_THRESHOLD_PX = 200
const HIGHLIGHT_MS = 2500

export type MessageListProps = MessageItemHandlers & {
  /** 스크린리더 레이블(예: '#전체 메시지') */
  label: string
  messages: ChatMessage[]
  hasMore: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
  /** "새 메시지" 선 기준(채널을 열 때의 last_read_at) */
  lastReadAt: string | null
  me: string
  nameOf: (userId: string | null) => string
  statusOf?: (userId: string | null) => string
  /** 채널 멤버(멘션 칩 이름을 실제 이름으로) */
  members?: readonly MentionMember[]
  editingId?: string | null
  pinnedIds?: ReadonlySet<string>
  bookmarkedIds?: ReadonlySet<string>
  canModerate?: boolean
  readOnly?: boolean
  /** 파일 탭 링크 기준(`/c/<slug>`·`/dm/<id>`) */
  filesBase?: string
  empty?: ReactNode
  /** 스크롤이 바닥에 닿았을 때(읽음 처리) */
  onReachBottom?: () => void
}

/**
 * 메시지 타임라인 — 날짜 구분선 · "새 메시지" 선 · 위로 스크롤 시 이전 페이지 · 바닥 고정.
 * - 처음엔 바닥으로. 바닥 근처에서 새 메시지가 오면 따라 내려가고, 위를 보고 있으면 "새 메시지 ↓" 단추.
 * - 이전 페이지를 앞에 붙일 때는 보던 위치를 유지한다(scrollHeight 차이만큼 보정).
 * 가상 스크롤은 2단계(브리프 §5) — 지금은 단순 리스트.
 */
export default function MessageList({
  label,
  messages,
  hasMore,
  loadingOlder = false,
  onLoadOlder,
  lastReadAt,
  me,
  nameOf,
  statusOf,
  members,
  editingId,
  pinnedIds,
  bookmarkedIds,
  canModerate,
  readOnly,
  filesBase,
  empty,
  onReachBottom,
  ...handlers
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const prevHeightRef = useRef(0)
  const prevFirstIdRef = useRef<string | null>(null)
  const prevLastIdRef = useRef<string | null>(null)
  const [unseenBelow, setUnseenBelow] = useState(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const items = useMemo(
    () => buildTimelineItems(messages, { lastReadAt, me }),
    [messages, lastReadAt, me]
  )

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo?.({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    if (!el.scrollTo) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setUnseenBelow(0)
  }, [])

  // 목록이 바뀐 뒤 스크롤 위치 조정(그리기 전에)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const first = messages[0]?.id ?? null
    const last = messages[messages.length - 1] ?? null
    const prevFirst = prevFirstIdRef.current
    const prevLast = prevLastIdRef.current

    if (prevLast === null && last) {
      // 첫 렌더
      el.scrollTop = el.scrollHeight
    } else if (first !== prevFirst && last?.id === prevLast) {
      // 앞에 이전 페이지가 붙었다 — 보던 자리 유지
      el.scrollTop += el.scrollHeight - prevHeightRef.current
    } else if (last && last.id !== prevLast) {
      if (atBottomRef.current || last.author_id === me) {
        el.scrollTop = el.scrollHeight
      } else {
        setUnseenBelow(n => n + 1)
      }
    }
    prevFirstIdRef.current = first
    prevLastIdRef.current = last?.id ?? null
    prevHeightRef.current = el.scrollHeight
  }, [messages, me])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    prevHeightRef.current = el.scrollHeight
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX
    if (atBottom && !atBottomRef.current) {
      setUnseenBelow(0)
      onReachBottom?.()
    }
    atBottomRef.current = atBottom
    if (el.scrollTop < TOP_LOAD_THRESHOLD_PX && hasMore && !loadingOlder) onLoadOlder?.()
  }, [hasMore, loadingOlder, onLoadOlder, onReachBottom])

  // 주소의 #msg-<id> 로 이동·잠깐 강조(검색 결과에서 들어올 때). 불러온 메시지(최신 50개) 밖이면 무시.
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const jump = (retried = false) => {
      const id = messageIdFromHash(window.location.hash)
      if (!id || !messagesRef.current.some(m => m.id === id)) return
      const el = document.getElementById(messageAnchor(id))
      if (!el || !scrollRef.current?.contains(el)) {
        // 접힌 이관 묶음(ImportGroup) 안의 메시지면 묶음이 같은 틱에 펼쳐지므로 한 번만 다시 시도한다
        if (!retried) retry = setTimeout(() => jump(true), 50)
        return
      }
      el.scrollIntoView?.({ block: 'center' })
      atBottomRef.current = false
      setHighlightId(id)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    }
    const onHash = () => jump()
    jump()
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      if (timer) clearTimeout(timer)
      if (retry) clearTimeout(retry)
    }
  }, [])

  // 바닥에 있는 상태에서 새 메시지가 오면 읽음 처리
  useEffect(() => {
    if (atBottomRef.current && messages.length > 0) onReachBottom?.()
  }, [messages.length, onReachBottom])

  const visible = items.some(i => i.type === 'message' || i.type === 'import-group')

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label={label}
        aria-live="polite"
        aria-relevant="additions"
        // 스크롤되는 메시지 목록은 키보드로 스크롤할 수 있어야 한다 — 원본 그대로
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        // overflow-anchor: none — 이전 페이지를 붙일 때 위 useLayoutEffect 가 scrollHeight 차이를 직접 더해
        // 위치를 지킨다. 브라우저 스크롤 앵커링(Chrome·Firefox 기본 켜짐)까지 켜져 있으면 같은 보정이 두 번
        // 적용돼 보던 자리가 아래로 밀린다(Safari 는 앵커링이 없어 수동 보정만 동작). 한쪽(수동)만 쓴다.
        className="h-full overflow-y-auto [overflow-anchor:none] pb-2 outline-none"
      >
        {hasMore ? (
          <div className="flex justify-center py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onLoadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {loadingOlder ? '불러오는 중…' : '이전 메시지 더 보기'}
            </Button>
          </div>
        ) : (
          visible && (
            <p className="px-4 pt-6 pb-2 text-center text-xs text-muted-foreground">
              대화의 처음입니다.
            </p>
          )
        )}

        {!visible && !hasMore && empty}

        {items.map(item => {
          if (item.type === 'day') {
            return (
              <div
                key={item.key}
                role="separator"
                aria-label={formatDayDivider(item.day)}
                className="relative my-4 flex items-center px-4"
              >
                <div aria-hidden="true" className="h-px flex-1 bg-border" />
                <span
                  aria-hidden="true"
                  className="mx-3 rounded-w-lg border bg-background px-3 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {formatDayDivider(item.day)}
                </span>
                <div aria-hidden="true" className="h-px flex-1 bg-border" />
              </div>
            )
          }
          if (item.type === 'new') {
            return (
              <div
                key={item.key}
                role="separator"
                aria-label="새 메시지"
                className="my-4 flex items-center px-4"
              >
                <div aria-hidden="true" className="h-px flex-1 bg-mention" />
                <span aria-hidden="true" className="ml-2 text-xs font-semibold text-mention">
                  새 메시지
                </span>
              </div>
            )
          }
          // ggac 이식: 이관(Teams import) 메시지 묶음 — 이 툴에는 이관 기능이 없어 생기지 않는다(ImportGroup 미이식).
          if (item.type === 'import-group') return null
          const m = item.message
          return (
            <MessageItem
              key={item.key}
              message={m}
              compact={item.compact}
              me={me}
              nameOf={nameOf}
              statusOf={statusOf}
              members={members}
              editing={editingId === m.id}
              pinned={pinnedIds?.has(m.id)}
              bookmarked={bookmarkedIds?.has(m.id)}
              canModerate={canModerate}
              readOnly={readOnly}
              filesBase={filesBase}
              anchor
              highlighted={highlightId === m.id}
              {...handlers}
            />
          )
        })}
      </div>

      {unseenBelow > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <Button
            type="button"
            size="sm"
            className="pointer-events-auto shadow-md"
            onClick={() => {
              scrollToBottom(true)
              onReachBottom?.()
            }}
          >
            <ArrowDownIcon aria-hidden="true" />새 메시지 {unseenBelow}개
          </Button>
        </div>
      )}
    </div>
  )
}
