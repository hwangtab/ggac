'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  subscribeChannelTopic,
  type PresenceMeta,
  type TopicEvent,
  type TopicHandle,
  type TopicStatus,
} from '@work/lib/messages/realtime'

/**
 * 입력 중 표시 유지 시간(이 시간 동안 새 신호가 없으면 지운다).
 * ggac 이식(폴링): 원본 3초 → 5초. 신호가 3초 폴마다 오므로 3초면 폴 사이에 깜빡인다(서버 보관도 5초, 02-sync.md §4).
 */
export const TYPING_TIMEOUT_MS = 5000
/** 입력 중 신호 송신 간격 */
const TYPING_SEND_INTERVAL_MS = 2000

export type TypingUser = { userId: string; displayName: string }

/**
 * 채널 토픽 구독 훅 — 실시간 이벤트 전달 + 연결 상태 · 접속 중(Presence) · 입력 중 상태.
 * channelId 가 null 이면 구독하지 않는다(멤버가 아닌 공개 채널 미리보기 등).
 *
 * - 구독 시점에 토픽이 이미 연결돼 있으면(사이드바·다른 화면이 먼저 열어 둠) 상태 변화 이벤트가
 *   오지 않으므로, onEvent 에 `{ type: 'status', status: 'connected' }` 를 한 번 흘려 준다 —
 *   호출부가 "구독이 붙은 시점"을 한 가지 방식으로 알 수 있게(첫 동기화·재연결 재조회).
 * - typingScope: 입력 중 신호의 범위. 채널 입력창은 null, 스레드 입력창은 부모 메시지 id.
 *   같은 범위의 신호만 표시하고, 보낼 때도 이 범위를 붙인다.
 */
export function useChannelTopic(
  channelId: string | null,
  opts: {
    track?: PresenceMeta | null
    onEvent?: (event: TopicEvent) => void
    typingScope?: string | null
    /** ggac 이식(폴링): 화면 로더가 준 시작 커서(loadChannelViewData().rev) */
    rev?: number | null
  } = {}
) {
  const [status, setStatus] = useState<TopicStatus>('connecting')
  const [online, setOnline] = useState<string[]>([])
  const [typing, setTyping] = useState<TypingUser[]>([])
  const onEventRef = useRef(opts.onEvent)
  const handleRef = useRef<TopicHandle | null>(null)
  const lastSentRef = useRef(0)

  useEffect(() => {
    onEventRef.current = opts.onEvent
  })

  const trackId = opts.track?.user_id ?? null
  const trackName = opts.track?.display_name ?? ''
  const typingScope = opts.typingScope ?? null
  const typingScopeRef = useRef(typingScope)
  typingScopeRef.current = typingScope
  const revRef = useRef(opts.rev ?? null)
  revRef.current = opts.rev ?? null

  useEffect(() => {
    if (!channelId) return
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const dropTyping = (userId: string) => {
      const t = timers.get(userId)
      if (t) clearTimeout(t)
      timers.delete(userId)
      setTyping(cur =>
        cur.some(u => u.userId === userId) ? cur.filter(u => u.userId !== userId) : cur
      )
    }
    const handle = subscribeChannelTopic(
      channelId,
      event => {
        if (event.type === 'status') setStatus(event.status)
        else if (event.type === 'presence') setOnline(event.userIds)
        else if (event.type === 'typing') {
          if (event.userId === trackId) return
          // 다른 입력창(채널 ↔ 스레드)의 신호는 여기서 보이지 않는다
          if ((event.scope ?? null) !== typingScopeRef.current) return
          setTyping(cur =>
            cur.some(u => u.userId === event.userId)
              ? cur
              : [...cur, { userId: event.userId, displayName: event.displayName }]
          )
          const prev = timers.get(event.userId)
          if (prev) clearTimeout(prev)
          timers.set(
            event.userId,
            setTimeout(() => dropTyping(event.userId), TYPING_TIMEOUT_MS)
          )
        } else if (event.type === 'message' && event.op === 'INSERT' && event.record?.author_id) {
          // 메시지를 보냈으면 그 사람의 입력 중 표시는 끝
          dropTyping(event.record.author_id)
        }
        onEventRef.current?.(event)
      },
      // ggac 이식(폴링): 시작 커서·스레드 범위를 허브에 알린다(요청의 channels·focus.threadId)
      trackId
        ? {
            track: { user_id: trackId, display_name: trackName },
            rev: revRef.current,
            scope: typingScopeRef.current,
          }
        : { rev: revRef.current }
    )
    handleRef.current = handle
    const initial = handle.getStatus()
    setStatus(initial)
    setOnline(handle.getOnline())
    if (initial === 'connected') onEventRef.current?.({ type: 'status', status: 'connected' })
    return () => {
      handle.unsubscribe()
      handleRef.current = null
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      setTyping([])
    }
  }, [channelId, trackId, trackName])

  const sendTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSentRef.current < TYPING_SEND_INTERVAL_MS) return
    lastSentRef.current = now
    handleRef.current?.sendTyping(typingScopeRef.current)
  }, [])

  return { status, online, typing, sendTyping }
}

/** 브라우저 네트워크 상태(navigator.onLine) */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
