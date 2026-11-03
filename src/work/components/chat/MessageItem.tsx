'use client'

import { memo, useCallback, useRef, useState, type KeyboardEvent } from 'react'
import Link from '@work/lib/nav/link'
import {
  BookmarkIcon,
  EllipsisIcon,
  MessageSquareReplyIcon,
  MoreHorizontalIcon,
  PinIcon,
  QuoteIcon,
  RotateCwIcon,
} from 'lucide-work'
import AttachmentList from '@work/components/files/AttachmentList'
import { Button } from '@work/components/ui/button'
import { Textarea } from '@work/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@work/components/ui/dropdown-menu'
import { emojiLabel } from '@work/lib/messages/emoji'
import { formatClock, formatFullDateTime, formatMessageTime } from '@work/lib/messages/format'
import { decodeMentions, encodeMentions } from '@work/lib/messages/mentions'
import { newTaskHref } from '@work/lib/tasks/schema'
import { groupReactions } from '@work/lib/messages/timeline'
import type { ChatMessage } from '@work/lib/messages/types'
import { cn } from '@work/lib/utils'
import ChatMarkdown, { type MentionMember } from './ChatMarkdown'
import { ForwardedNote, QuoteCard } from './QuoteCard'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import CollapsibleBody from './CollapsibleBody'
import MessageActionSheet from './MessageActionSheet'
import ReactionPicker from './ReactionPicker'
import SystemMessage from './SystemMessage'
import { useLongPress } from './use-long-press'

export type MessageItemHandlers = {
  onReact?: (message: ChatMessage, emoji: string) => void
  /** 스레드 열기(없으면 답글 버튼·요약을 그리지 않는다 — 스레드 안에서) */
  onOpenThread?: (message: ChatMessage) => void
  onStartEdit?: (message: ChatMessage) => void
  onCancelEdit?: () => void
  onSaveEdit?: (message: ChatMessage, body: string) => Promise<boolean>
  onDelete?: (message: ChatMessage) => void
  onTogglePin?: (message: ChatMessage) => void
  onToggleBookmark?: (message: ChatMessage) => void
  onRetry?: (message: ChatMessage) => void
  /** 인용 답장(0028) — 입력창 위에 미리보기를 띄운다 */
  onQuote?: (message: ChatMessage) => void
  /** 다른 대화로 전달(0028) — 전달 대화상자를 연다 */
  onForward?: (message: ChatMessage) => void
}

export type MessageItemProps = MessageItemHandlers & {
  message: ChatMessage
  compact?: boolean
  me: string
  /** user_id → 표시 이름 */
  nameOf: (userId: string | null) => string
  /** user_id → 상태 메시지 한 줄("🌴 휴가 중", 없거나 만료면 빈 문자열) — 작성자 이름 툴팁 */
  statusOf?: (userId: string | null) => string
  /** 채널 멤버(멘션 칩 이름을 실제 이름으로) */
  members?: readonly MentionMember[]
  editing?: boolean
  pinned?: boolean
  bookmarked?: boolean
  /** 관리자(남의 메시지 삭제 가능) */
  canModerate?: boolean
  /** 멤버가 아니면(공개 채널 미리보기) 조작 불가 */
  readOnly?: boolean
  highlighted?: boolean
  /** 파일 탭 링크 기준(`/c/<slug>`·`/dm/<id>`) — 이관 시스템 메시지의 "이 폴더 열기" */
  filesBase?: string
  /** 인용 카드가 스레드 답글을 가리킬 때 쓰는 대화 경로(`/c/<slug>`·`/dm/<id>`). 없으면 filesBase */
  conversationBase?: string
  /**
   * 타임라인 앵커(id="msg-<id>") — 검색 결과 링크 `#msg-<id>` 가 가리킨다.
   * 같은 메시지가 스레드 패널에도 그려지므로 타임라인(MessageList)에서만 켠다(id 중복 방지).
   */
  anchor?: boolean
}

function InlineEditor({
  message,
  onCancel,
  onSave,
}: {
  message: ChatMessage
  onCancel: () => void
  onSave: (body: string) => Promise<boolean>
}) {
  const [{ text, picks }] = useState(() => decodeMentions(message.body))
  const [value, setValue] = useState(text)
  const [saving, setSaving] = useState(false)
  const composingRef = useRef(false)

  async function save() {
    const body = encodeMentions(value.trim(), picks)
    if (!body || saving) return
    setSaving(true)
    const ok = await onSave(body)
    setSaving(false)
    if (ok) onCancel()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중 Enter·Esc 는 조합 확정·취소다(저장·취소로 보지 않는다)
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div className="mt-1 space-y-1">
      <Textarea
        aria-label="메시지 고치기"
        value={value}
        // 편집을 시작하면 바로 입력할 수 있게(↑ 키 편집)
        autoFocus
        onFocus={e => e.currentTarget.setSelectionRange(value.length, value.length)}
        onChange={e => setValue(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onBlur={() => {
          composingRef.current = false
        }}
        onKeyDown={onKeyDown}
        rows={Math.min(8, Math.max(2, value.split('\n').length))}
        className="block [field-sizing:fixed] min-h-0 resize-y rounded-w-lg bg-background px-2 py-1.5"
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Esc 취소 · Enter 저장</span>
        <Button type="button" size="xs" variant="outline" onClick={onCancel} className="ml-auto">
          취소
        </Button>
        <Button
          type="button"
          size="xs"
          onClick={() => void save()}
          disabled={saving || !value.trim()}
        >
          저장
        </Button>
      </div>
    </div>
  )
}

function MessageItem({
  message,
  compact = false,
  me,
  nameOf,
  statusOf,
  members,
  editing = false,
  pinned = false,
  bookmarked = false,
  canModerate = false,
  readOnly = false,
  highlighted = false,
  filesBase,
  anchor = false,
  conversationBase,
  onReact,
  onOpenThread,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onTogglePin,
  onToggleBookmark,
  onRetry,
  onQuote,
  onForward,
}: MessageItemProps) {
  const deleted = Boolean(message.deleted_at)
  const mine = message.author_id === me
  const authorName =
    message.kind === 'bot' ? `${nameOf(message.author_id)} (봇)` : nameOf(message.author_id)
  const reactions = groupReactions(message.reactions, me)
  const canEdit =
    mine &&
    !deleted &&
    !message.status &&
    message.kind === 'text' &&
    !message.forwarded_from_id &&
    !!onStartEdit
  const canDelete = (mine || canModerate) && !deleted && !!onDelete
  const showActions = !readOnly && !deleted && !message.status && !editing
  const headingId = `msg-${message.id}-author`
  // 터치 기기: hover 전용 작업 막대 대신 하단 작업 시트(길게 누르기 또는 ⋯)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const openSheet = useCallback(() => setSheetOpen(true), [])
  const longPress = useLongPress(openSheet, { enabled: showActions })

  if (message.kind === 'system') {
    return (
      <SystemMessage
        message={message}
        anchor={anchor}
        filesBase={filesBase}
        highlighted={highlighted}
      />
    )
  }

  return (
    <article
      id={anchor ? `msg-${message.id}` : undefined}
      data-message-id={message.id}
      aria-labelledby={compact ? undefined : headingId}
      {...longPress}
      className={cn(
        'group relative flex scroll-mt-4 gap-3 px-4 transition-colors hover:bg-subtle focus-within:bg-subtle',
        compact ? 'py-0.5' : 'py-1',
        showActions && '[@media(hover:none)]:pr-12',
        highlighted && 'bg-primary/10',
        pinned && 'border-l-2 border-primary'
      )}
    >
      <div className="w-9 shrink-0 select-none" aria-hidden={compact || undefined}>
        {compact ? (
          <span className="invisible block pt-0.5 text-right text-[11px] text-muted-foreground group-hover:visible">
            {formatClock(message.created_at)}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-[50%] bg-accent text-sm font-semibold text-subtle-foreground"
          >
            {authorName.slice(0, 1)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span
              id={headingId}
              className="truncate text-sm font-medium text-foreground"
              title={statusOf?.(message.author_id) || undefined}
            >
              {authorName}
            </span>
            {statusOf?.(message.author_id) && (
              <span className="sr-only">(상태: {statusOf(message.author_id)})</span>
            )}
            <time
              dateTime={message.created_at}
              data-tooltip={formatFullDateTime(message.created_at)}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {formatMessageTime(message.created_at)}
            </time>
            {pinned && (
              <span className="flex items-center gap-0.5 text-xs text-primary">
                <PinIcon aria-hidden="true" className="size-3" />
                고정됨
              </span>
            )}
          </div>
        )}
        {compact && (
          <span className="sr-only">
            {authorName}, {formatMessageTime(message.created_at)}
          </span>
        )}

        {deleted ? (
          <p className="text-sm text-muted-foreground italic">삭제된 메시지입니다.</p>
        ) : editing && onSaveEdit && onCancelEdit ? (
          <InlineEditor
            message={message}
            onCancel={onCancelEdit}
            onSave={body => onSaveEdit(message, body)}
          />
        ) : (
          <div className={cn(message.status === 'pending' && 'opacity-60')}>
            <QuoteCard message={message} nameOf={nameOf} base={conversationBase ?? filesBase} />
            {message.body && (
              <CollapsibleBody body={message.body}>
                <ChatMarkdown content={message.body} me={me} members={members} />
              </CollapsibleBody>
            )}
            {message.edited_at && <span className="text-xs text-muted-foreground">(수정됨)</span>}
            <ForwardedNote message={message} />
            {message.attachments.length > 0 ? (
              <AttachmentList attachments={message.attachments} />
            ) : (
              message.attachments_count > 0 && (
                // 첨부 확정·다시 읽기 전 잠깐
                <p className="text-xs text-muted-foreground">
                  첨부 {message.attachments_count}개 불러오는 중…
                </p>
              )
            )}
          </div>
        )}

        {message.status === 'failed' && (
          <div role="alert" className="mt-1 flex items-center gap-2 text-xs text-destructive">
            전송하지 못했습니다.
            {onRetry && (
              <Button type="button" size="xs" variant="outline" onClick={() => onRetry(message)}>
                <RotateCwIcon aria-hidden="true" />
                다시 보내기
              </Button>
            )}
            {onDelete && (
              <Button type="button" size="xs" variant="ghost" onClick={() => onDelete(message)}>
                지우기
              </Button>
            )}
          </div>
        )}

        {reactions.length > 0 && !deleted && (
          <ul aria-label="반응" className="mt-1 flex flex-wrap gap-1">
            {reactions.map(r => {
              const who = r.userIds.map(id => nameOf(id)).join(', ')
              return (
                <li key={r.emoji}>
                  <button
                    type="button"
                    disabled={readOnly || !onReact}
                    onClick={() => onReact?.(message, r.emoji)}
                    aria-pressed={r.mine}
                    aria-label={`${emojiLabel(r.emoji)} ${r.count}명: ${who}`}
                    data-tooltip={who}
                    className={cn(
                      'flex h-6 items-center gap-1 rounded-w-lg border px-2 text-xs pointer-coarse:h-9 pointer-coarse:px-3 outline-none',
                      r.mine
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'bg-background hover:bg-accent'
                    )}
                  >
                    <span aria-hidden="true">{r.emoji}</span>
                    <span aria-hidden="true">{r.count}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {onOpenThread && message.reply_count > 0 && (
          <button
            type="button"
            onClick={() => onOpenThread(message)}
            className="mt-1 flex items-center gap-1 rounded-w-lg text-xs font-medium text-primary pointer-coarse:min-h-11 outline-none hover:underline"
          >
            <MessageSquareReplyIcon aria-hidden="true" className="size-3.5" />
            답글 {message.reply_count}개
            {message.last_reply_at && (
              <span className="font-normal text-muted-foreground">
                · 마지막 답글 {formatMessageTime(message.last_reply_at)}
              </span>
            )}
          </button>
        )}
      </div>

      {showActions && (
        <div
          role="toolbar"
          aria-label={`${authorName}의 메시지 작업`}
          className="absolute -top-4 right-4 flex items-center gap-0.5 rounded-w-lg border bg-background p-0.5 opacity-0 shadow [@media(hover:none)]:hidden group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
        >
          {onReact && <ReactionPicker onPick={emoji => onReact(message, emoji)} />}
          {onOpenThread && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="스레드에 답글"
              onClick={() => onOpenThread(message)}
            >
              <MessageSquareReplyIcon aria-hidden="true" />
            </Button>
          )}
          {onQuote && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="인용하여 답장"
              onClick={() => onQuote(message)}
            >
              <QuoteIcon aria-hidden="true" />
            </Button>
          )}
          {onToggleBookmark && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={bookmarked ? '북마크 해제' : '북마크'}
              aria-pressed={bookmarked}
              onClick={() => onToggleBookmark(message)}
            >
              <BookmarkIcon aria-hidden="true" className={cn(bookmarked && 'fill-current')} />
            </Button>
          )}
          {(canEdit || canDelete || onTogglePin || onForward) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="메시지 더 보기"
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36">
                {onTogglePin && (
                  <DropdownMenuItem onClick={() => onTogglePin(message)}>
                    {pinned ? '고정 해제' : '채널에 고정'}
                  </DropdownMenuItem>
                )}
                {onForward && (
                  <DropdownMenuItem onClick={() => onForward(message)}>
                    다른 대화로 전달
                  </DropdownMenuItem>
                )}
                {message.kind === 'text' && (
                  <DropdownMenuItem render={<Link href={newTaskHref(message)} />}>
                    할 일로 만들기
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onClick={() => onStartEdit?.(message)}>
                    메시지 고치기
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                      메시지 삭제
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {showActions && (
        <>
          <button
            type="button"
            aria-label="메시지 작업 열기"
            aria-haspopup="dialog"
            onClick={openSheet}
            className="absolute top-0 right-1 hidden size-11 items-center justify-center rounded-w-lg text-muted-foreground outline-none [@media(hover:none)]:flex"
          >
            <EllipsisIcon aria-hidden="true" className="size-5" />
          </button>
          <MessageActionSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            authorName={authorName}
            onReact={onReact && (emoji => onReact(message, emoji))}
            onOpenThread={onOpenThread && (() => onOpenThread(message))}
            onQuote={onQuote && (() => onQuote(message))}
            onForward={onForward && (() => onForward(message))}
            onToggleBookmark={onToggleBookmark && (() => onToggleBookmark(message))}
            bookmarked={bookmarked}
            onTogglePin={onTogglePin && (() => onTogglePin(message))}
            pinned={pinned}
            taskHref={message.kind === 'text' ? newTaskHref(message) : undefined}
            onEdit={canEdit ? () => onStartEdit?.(message) : undefined}
            onCopy={
              message.body
                ? () => void navigator.clipboard?.writeText(decodeMentions(message.body).text)
                : undefined
            }
            onDelete={canDelete ? () => setDeleteOpen(true) : undefined}
          />
        </>
      )}
      {canDelete && (
        <ConfirmDialog
          open={deleteOpen}
          title="메시지를 삭제할까요?"
          description="삭제하면 되돌릴 수 없습니다. 메시지 내용이 지워지고 “삭제된 메시지입니다.”로 표시됩니다."
          confirmLabel="삭제"
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => {
            setDeleteOpen(false)
            onDelete?.(message)
          }}
        />
      )}
    </article>
  )
}

export default memo(MessageItem)
