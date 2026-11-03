'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Loader2Icon } from 'lucide-work'
import { loadThread } from '@work/lib/messages/actions'
import type { TopicEvent } from '@work/lib/messages/realtime'
import {
  needsAttachmentRefetch,
  timelineReducer,
  type TimelineState,
} from '@work/lib/messages/timeline'
import AttachmentPicker from '@work/components/files/AttachmentPicker'
import { useCreateDocument } from '@work/components/files/create-document/use-create-document'
import type { CreateActor } from '@work/lib/files/create-rules'
import { draftKey } from '@work/lib/messages/drafts'
import { toQuoteTarget, type QuoteTarget } from '@work/lib/messages/quote'
import type { ChatMessage } from '@work/lib/messages/types'
import MessageComposer, { type MentionCandidate } from './MessageComposer'
import type { MentionMember } from './ChatMarkdown'
import MessageItem from './MessageItem'
import QuotePreview from './QuotePreview'
import { TypingIndicator } from './ChatStatus'
import { useChannelTopic } from './use-channel-topic'
import { useAttachmentSync } from './use-attachment-sync'
import { useComposerAttachments } from './use-composer-attachments'
import { useForward } from './use-forward'
import { useMessageOps } from './use-message-ops'

export type ThreadPanelProps = {
  channelId: string
  parentId: string
  /** 처음 그릴 부모(타임라인에 있던 것) — 서버 응답 전 깜빡임 방지 */
  initialParent?: ChatMessage | null
  me: { id: string; displayName: string }
  nameOf: (userId: string | null) => string
  statusOf?: (userId: string | null) => string
  mentionCandidates: MentionCandidate[]
  /** 채널 멤버(멘션 칩 이름을 실제 이름으로) */
  members?: readonly MentionMember[]
  allowChannelMention: boolean
  readOnly: boolean
  canModerate: boolean
  /** 열자마자 스크롤·잠깐 강조할 답글 id(검색·멘션에서 들어올 때, QA #2) */
  highlightId?: string | null
  /** 원본 대화 종류(전달 확인 판단) */
  channelKind?: string
  /** 대화 경로(`/c/<slug>`·`/dm/<id>`) — 인용 카드가 스레드 답글을 가리킬 때 */
  conversationBase?: string
  /** 새 문서 만들기 판정 재료(docs/16). 없으면 버튼을 그리지 않는다 */
  createDocActor?: Omit<CreateActor, 'inThread'>
}

const HIGHLIGHT_MS = 2500
/** createDocActor 가 없으면 새 문서 버튼을 숨기는 값 */
const NO_CREATE_ACTOR: Omit<CreateActor, 'inThread'> = {
  isGuest: true,
  isMember: false,
  archived: true,
  postPolicy: 'everyone',
  isChannelOwner: false,
  isAdmin: false,
}

/**
 * 우측 패널 스레드: 부모 메시지 + 답글 목록 + 답글 입력창.
 * 패널 내용은 RightPanelSlot 에서 그려지므로(채널 화면 트리 밖) 실시간 구독을 스스로 한다 —
 * 토픽 허브가 채널 화면과 같은 RealtimeChannel 을 나눠 쓴다.
 */
export default function ThreadPanel({
  channelId,
  parentId,
  initialParent,
  me,
  nameOf,
  statusOf,
  mentionCandidates,
  members,
  allowChannelMention,
  readOnly,
  canModerate,
  highlightId = null,
  channelKind = 'public',
  conversationBase,
  createDocActor,
}: ThreadPanelProps) {
  const [state, dispatch] = useReducer(
    timelineReducer,
    undefined,
    (): TimelineState => ({
      messages: initialParent ? [initialParent] : [],
      hasMore: false,
    })
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const ops = useMessageOps({ dispatch, me: me.id, onError: setError })
  // 인용 답장(0028) · 전달 — 스레드 안에서도 같은 작업을 쓴다
  const [quote, setQuote] = useState<QuoteTarget | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)
  // 스레드를 열면 답글 입력창으로 바로 쓰게 한다(Slack·Teams 와 같게). 터치 기기는 키보드가 화면을
  // 가리므로 마우스 같은 정밀 포인터일 때만.
  useEffect(() => {
    try {
      if (window.matchMedia?.('(pointer: fine)').matches) setFocusSignal(n => n + 1)
    } catch {
      // matchMedia 가 없으면 포커스를 옮기지 않는다
    }
  }, [parentId])
  const onQuote = useCallback((m: ChatMessage) => {
    setQuote(toQuoteTarget(m))
    setFocusSignal(n => n + 1)
  }, [])
  const fwd = useForward({ sourceKind: channelKind, nameOf })
  const attachments = useComposerAttachments({
    channelId,
    parentId,
    onAttached: (id, list) => dispatch({ type: 'attachments', id, attachments: list }),
  })
  const createDoc = useCreateDocument({
    channelId,
    parentId,
    actor: createDocActor ?? NO_CREATE_ACTOR,
  })
  const syncAttachments = useAttachmentSync(dispatch)
  const messagesRef = useRef(state.messages)
  messagesRef.current = state.messages

  const refetch = useCallback(async () => {
    const res = await loadThread({ parentId })
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    dispatch({ type: 'merge', messages: [res.data.parent, ...res.data.replies] })
  }, [parentId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const wasDownRef = useRef(false)
  const onEvent = useCallback(
    (event: TopicEvent) => {
      if (event.type === 'message') {
        const rec = event.record ?? event.old
        if (!rec || (rec.id !== parentId && rec.parent_id !== parentId)) return
        if (event.op === 'DELETE') dispatch({ type: 'remove', id: rec.id })
        else if (event.record) {
          const existing = messagesRef.current.find(m => m.id === event.record?.id)
          dispatch({ type: 'record', record: event.record })
          if (needsAttachmentRefetch(event.record, existing)) syncAttachments(event.record.id)
        }
      } else if (event.type === 'reaction') {
        const r = event.record ?? event.old
        if (r)
          dispatch({ type: 'reaction', op: event.op === 'INSERT' ? 'add' : 'remove', reaction: r })
      } else if (event.type === 'status') {
        // 끊겼다 다시 붙으면 그 사이 놓친 답글을 다시 읽는다
        if (event.status === 'error' || event.status === 'closed') wasDownRef.current = true
        else if (event.status === 'connected' && wasDownRef.current) {
          wasDownRef.current = false
          void refetch()
        }
      }
    },
    [parentId, refetch, syncAttachments]
  )
  // 스레드 입력창의 입력 중 신호는 이 스레드 범위로만 주고받는다(채널 입력창과 섞이지 않게)
  const topic = useChannelTopic(readOnly ? null : channelId, {
    onEvent,
    track: { user_id: me.id, display_name: me.displayName },
    typingScope: parentId,
  })

  const parent = state.messages.find(m => m.id === parentId) ?? null
  const replies = state.messages.filter(m => m.parent_id === parentId)

  // 강조할 답글: 불러온 뒤 한 번만 그 자리로 스크롤하고 잠깐 강조
  const scrollRef = useRef<HTMLDivElement>(null)
  const jumpedRef = useRef(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const hasTarget = highlightId ? replies.some(m => m.id === highlightId) : false
  useEffect(() => {
    if (!highlightId || jumpedRef.current || loading || !hasTarget) return
    jumpedRef.current = true
    const el = scrollRef.current?.querySelector(`[data-message-id="${highlightId}"]`)
    el?.scrollIntoView?.({ block: 'center' })
    setFlashId(highlightId)
  }, [highlightId, loading, hasTarget])
  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [flashId])

  const handlers = {
    onReact: readOnly ? undefined : ops.react,
    onStartEdit: (m: ChatMessage) => setEditingId(m.id),
    onCancelEdit: () => setEditingId(null),
    onSaveEdit: ops.edit,
    onDelete: ops.remove,
    onRetry: (m: ChatMessage) =>
      void ops.send({
        channelId,
        body: m.body,
        parentId,
        retryId: m.id,
        quotedMessageId: m.quoted_message_id,
      }),
    onQuote: readOnly ? undefined : onQuote,
    onForward: fwd.forward,
    conversationBase,
  }

  return (
    <div className="flex h-full flex-col">
      {/* 위 여백 pt-5: 맨 위 메시지의 호버 툴바(-top-4)가 스크롤 상자 위쪽에 잘리지 않게 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pt-5 pb-2">
        {parent ? (
          <MessageItem
            message={parent}
            me={me.id}
            nameOf={nameOf}
            statusOf={statusOf}
            members={members}
            readOnly={readOnly}
            canModerate={canModerate}
            editing={editingId === parent.id}
            {...handlers}
          />
        ) : loading ? null : (
          <p className="px-4 py-6 text-sm text-muted-foreground">스레드를 찾을 수 없습니다.</p>
        )}
        <div className="my-4 flex items-center gap-2 px-4 text-xs text-muted-foreground">
          <span>{replies.length > 0 ? `답글 ${replies.length}개` : '아직 답글이 없습니다'}</span>
          <div aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        {loading && (
          <p role="status" className="flex items-center gap-2 px-4 text-xs text-muted-foreground">
            <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
            답글을 불러오는 중…
          </p>
        )}
        <div role="log" aria-label="답글" aria-live="polite">
          {replies.map(m => (
            <MessageItem
              key={m.id}
              message={m}
              me={me.id}
              nameOf={nameOf}
              statusOf={statusOf}
              members={members}
              readOnly={readOnly}
              canModerate={canModerate}
              editing={editingId === m.id}
              highlighted={flashId === m.id}
              {...handlers}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="px-4 pt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {fwd.notice}
      {fwd.dialog}
      {!readOnly && parent && !parent.deleted_at && (
        <>
          <TypingIndicator users={topic.typing} />
          <AttachmentPicker uploads={attachments.uploads}>
            <MessageComposer
              label="스레드에 답글 보내기"
              placeholder="답글 보내기…"
              mentionCandidates={mentionCandidates}
              allowChannelMention={allowChannelMention}
              onTyping={topic.sendTyping}
              onSubmit={({ body, attachmentIds }) => {
                const quoted = quote
                setQuote(null)
                return ops.send({
                  channelId,
                  body,
                  parentId,
                  attachmentIds,
                  quotedMessageId: quoted?.id,
                })
              }}
              draftKey={draftKey(me.id, channelId, parentId)}
              focusSignal={focusSignal}
              quoteSlot={
                quote ? (
                  <QuotePreview
                    authorName={nameOf(quote.authorId)}
                    body={quote.body}
                    onCancel={() => setQuote(null)}
                  />
                ) : undefined
              }
              onSent={attachments.onSent}
              onAttach={attachments.onAttach}
              onCreateDocument={createDoc.available ? () => createDoc.open(null) : undefined}
              attachmentsSlot={attachments.attachmentsSlot}
              pendingAttachmentIds={attachments.pendingAttachmentIds}
              sendBlocked={attachments.sendBlocked}
              onFiles={attachments.onFiles}
              className="pt-0"
            />
          </AttachmentPicker>
          {createDoc.dialog}
        </>
      )}
    </div>
  )
}
