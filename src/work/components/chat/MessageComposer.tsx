'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { FilePlusIcon, PaperclipIcon, SendHorizontalIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  type MentionPick,
} from '@work/lib/messages/mentions'
import {
  loadDraft,
  persistDraft,
  pruneDrafts,
  readDraftStamp,
  removeDraft,
  type DraftSync,
} from '@work/lib/messages/drafts'
import { useCoarsePointer } from '@work/lib/messages/coarse-pointer'
import { cn } from '@work/lib/utils'

export type MentionCandidate = {
  id: string
  name: string
  title?: string | null
  /** 상태 메시지 한 줄(0027, 만료는 만든 쪽이 거른다) */
  status?: string | null
}

export type MessageComposerProps = {
  /** 입력창 접근성 이름(예: '#전체에 메시지 보내기') */
  label: string
  placeholder?: string
  disabled?: boolean
  /** @ 자동완성 후보(보통 채널 멤버) */
  mentionCandidates?: MentionCandidate[]
  /** @channel 후보를 보일지(DM 에서는 끈다) */
  allowChannelMention?: boolean
  /**
   * 전송. 본문은 멘션 토큰이 들어간 저장 형식이다. 성공하면 저장된 메시지 id, 실패하면 null.
   * (보통 useMessageOps().send → sendMessage 서버 액션)
   */
  onSubmit: (input: { body: string; attachmentIds: string[] }) => Promise<string | null>
  /** 저장 성공 직후 — 파일 영역이 첨부 레코드를 이 메시지에 연결한다 */
  onSent?: (messageId: string, attachmentIds: string[]) => void | Promise<void>
  /** 입력창이 비어 있을 때 ↑ — 내 마지막 메시지 편집 */
  onEditLast?: () => void
  /** 입력 중 신호(호출부가 송신 간격을 조절한다) */
  onTyping?: () => void
  /** 첨부 버튼(파일 영역 슬롯). 없으면 버튼을 그리지 않는다 */
  onAttach?: () => void
  /** 새 문서 만들기 버튼(파일 영역 슬롯, docs/16). 없으면 버튼을 그리지 않는다 */
  onCreateDocument?: () => void
  /** 입력창 위 첨부 미리보기 등(파일 영역 슬롯) */
  attachmentsSlot?: ReactNode
  /** 보낼 첨부 id — 있으면 본문이 비어도 보낼 수 있다 */
  pendingAttachmentIds?: string[]
  /** 전송만 잠시 막는다(첨부 업로드 중 등). 입력은 계속할 수 있다 */
  sendBlocked?: boolean
  /** 붙여넣기·드래그로 들어온 파일(파일 영역 슬롯) */
  onFiles?: (files: File[]) => void
  /**
   * 임시 저장 키(`kw-draft:<channelId>[:<parentId>]`, src/lib/messages/drafts.ts). 주면 입력 중인 글을
   * 기기 localStorage 에 보존하고 다시 열 때 복원한다(첨부 대기 목록은 제외). 보내거나 비우면 지운다.
   */
  draftKey?: string
  /** 입력창 위 인용 미리보기 등 */
  quoteSlot?: ReactNode
  /** 값이 바뀔 때마다 입력창에 포커스(인용 시작 등) */
  focusSignal?: number
  className?: string
}

/** 입력이 멈춘 뒤 임시 저장하기까지의 지연 */
const DRAFT_SAVE_DELAY_MS = 400

const MAX_HEIGHT_PX = 240
const CHANNEL_CANDIDATE: MentionCandidate = {
  id: 'channel',
  name: 'channel',
  title: '채널 멤버 전원',
}

/**
 * 메시지 입력창. Enter 전송 · Shift+Enter 줄바꿈(터치 기기는 Enter 줄바꿈 · 버튼 전송) · 자동 높이 · `@` 멘션 자동완성.
 * 한글 IME 조합 중 Enter 는 조합 확정이므로 전송하지 않는다(isComposing).
 * 입력창에는 `@이름` 만 보이고, 전송할 때 고른 사람으로 `@[이름](user:<id>)` 토큰을 만든다.
 */
export default function MessageComposer({
  label,
  placeholder,
  disabled = false,
  mentionCandidates = [],
  allowChannelMention = true,
  onSubmit,
  onSent,
  onEditLast,
  onTyping,
  onAttach,
  onCreateDocument,
  attachmentsSlot,
  pendingAttachmentIds,
  sendBlocked = false,
  onFiles,
  draftKey,
  quoteSlot,
  focusSignal,
  className,
}: MessageComposerProps) {
  // 터치 기기: Enter = 줄바꿈, 보내기는 버튼(휴대폰에는 Shift+Enter 가 없다)
  const coarse = useCoarsePointer()
  const [value, setValue] = useState('')
  const [picks, setPicks] = useState<MentionPick[]>([])
  const [sending, setSending] = useState(false)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  /** 자동완성으로 값을 바꾼 뒤 놓을 커서 위치(다음 커밋 직후 한 번 적용) */
  const caretRef = useRef<number | null>(null)
  /**
   * IME 조합 중인가. keydown 의 isComposing·keyCode 229 만으로는 브라우저마다 빈틈이 있어
   * (조합 확정 Enter 의 keydown 이 compositionend 와 어느 쪽이 먼저 오는지 다르다) 이벤트로도 추적한다.
   */
  const composingRef = useRef(false)
  const listId = useId()
  const hintId = useId()

  // ── 임시 저장 ───────────────────────────────────────────────────────────
  // 복원은 마운트 뒤(localStorage 는 서버 렌더에 없다). 복원한 값이 실제로 렌더된 뒤(draftReady === draftKey)에만
  // 저장·갱신한다 — 복원 전의 빈 값이 저장돼 임시 저장을 지우는 일을 막는다(StrictMode 이중 실행 포함).
  const [draftReady, setDraftReady] = useState<string | null>(null)
  const latestDraftRef = useRef<{ key: string | undefined; text: string }>({
    key: undefined,
    text: '',
  })
  // 이 탭이 마지막으로 읽었거나 저장한 상태 — 값이 바뀌었을 때(dirty)만 저장하고, 다른 탭이 더 새로 저장했으면 덮지 않는다
  const syncRef = useRef<DraftSync>({ text: '', t: 0 })
  /** 키(대화)와 글을 받아 dirty·최신성 검사를 거쳐 저장 */
  const persist = useCallback((key: string, text: string) => {
    syncRef.current = persistDraft(key, text, syncRef.current)
  }, [])
  useEffect(() => {
    if (!draftKey) return
    pruneDrafts()
    // 키가 바뀌면(같은 입력창이 다른 대화에 재사용) 이전 대화의 글이 남지 않게 항상 덮어쓴다
    const loaded = loadDraft(draftKey) ?? ''
    const restored = decodeMentions(loaded)
    syncRef.current = { text: loaded, t: readDraftStamp(draftKey)?.t ?? 0 }
    setValue(restored.text)
    setPicks(restored.picks)
    setDraftReady(draftKey)
    return () => {
      // 키가 바뀌거나 화면을 떠날 때 이전 키의 마지막 글을 기다리지 않고 저장한다
      const last = latestDraftRef.current
      if (last.key === draftKey) persist(draftKey, last.text)
    }
  }, [draftKey, persist])
  // 다른 탭이 같은 대화의 임시 저장을 바꿨다: 이 탭에 저장 안 된 입력이 없으면 그 글로 맞추고, 있으면 건드리지 않는다
  useEffect(() => {
    if (!draftKey) return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== draftKey) return
      if (latestDraftRef.current.key !== draftKey) return
      if (latestDraftRef.current.text !== syncRef.current.text) return // 이 탭에서 쓰던 글이 있다
      const loaded = loadDraft(draftKey) ?? ''
      if (loaded === syncRef.current.text) return
      const restored = decodeMentions(loaded)
      syncRef.current = { text: loaded, t: readDraftStamp(draftKey)?.t ?? 0 }
      setValue(restored.text)
      setPicks(restored.picks)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [draftKey])

  const draftText = useMemo(() => encodeMentions(value, picks), [value, picks])
  const draftActive = Boolean(draftKey) && draftReady === draftKey
  // 커밋 뒤에 갱신한다 — 위 cleanup 이 "이전 렌더의 값"을 읽을 수 있게(렌더 중 갱신하면 새 키·옛 글이 섞인다)
  useEffect(() => {
    if (draftActive) latestDraftRef.current = { key: draftKey, text: draftText }
  })
  useEffect(() => {
    if (!draftKey || !draftActive) return
    const t = setTimeout(() => persist(draftKey, draftText), DRAFT_SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [draftKey, draftActive, draftText, persist])
  // 탭을 닫거나 숨길 때는 기다리지 않고 바로 저장한다
  useEffect(() => {
    const flush = () => {
      const { key, text } = latestDraftRef.current
      if (key) persist(key, text)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [persist])

  useEffect(() => {
    if (focusSignal) ref.current?.focus()
  }, [focusSignal])

  const attachmentIds = useMemo(() => pendingAttachmentIds ?? [], [pendingAttachmentIds])
  const canSend =
    !disabled && !sending && !sendBlocked && (value.trim().length > 0 || attachmentIds.length > 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
    // 커서는 값이 반영된 바로 그 커밋에서 옮긴다. requestAnimationFrame 으로 미루면
    // 그 사이 입력된 글자 뒤에서 커서가 되돌아가 글자 순서가 뒤섞인다(빠른 입력·느린 프레임).
    const caret = caretRef.current
    if (caret !== null) {
      caretRef.current = null
      if (document.activeElement !== el) el.focus()
      el.setSelectionRange(caret, caret)
    }
  }, [value])

  const suggestions = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    const pool = allowChannelMention ? [...mentionCandidates, CHANNEL_CANDIDATE] : mentionCandidates
    return pool.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [mention, mentionCandidates, allowChannelMention])
  const listOpen = suggestions.length > 0

  const updateMention = useCallback((text: string, caret: number) => {
    const next = activeMentionQuery(text, caret)
    setMention(next)
    setActiveIndex(0)
  }, [])

  const choose = useCallback(
    (candidate: MentionCandidate) => {
      const el = ref.current
      if (!el || !mention) return
      const caret = el.selectionStart ?? value.length
      const insert = `@${candidate.name} `
      const next = value.slice(0, mention.start) + insert + value.slice(caret)
      setValue(next)
      if (candidate !== CHANNEL_CANDIDATE) {
        setPicks(cur =>
          cur.some(p => p.id === candidate.id)
            ? cur
            : [...cur, { id: candidate.id, name: candidate.name }]
        )
      }
      setMention(null)
      caretRef.current = mention.start + insert.length
    },
    [mention, value]
  )

  const submit = useCallback(async () => {
    if (!canSend) return
    const body = encodeMentions(value.trim(), picks)
    const ids = attachmentIds
    setSending(true)
    // 낙관적: 바로 비운다. 실패하면 타임라인에 '전송 실패'로 남고 거기서 다시 보낸다
    setValue('')
    setPicks([])
    setMention(null)
    if (draftKey) {
      removeDraft(draftKey)
      syncRef.current = { text: '', t: Date.now() }
    }
    try {
      const id = await onSubmit({ body, attachmentIds: ids })
      if (id && onSent) await onSent(id, ids)
    } finally {
      setSending(false)
      ref.current?.focus()
    }
  }, [canSend, value, picks, attachmentIds, onSubmit, onSent, draftKey])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중 Enter 는 글자 확정이다 — 여기서 보내면 조합 중 글자가 빠지거나, 확정된 글자가
    // 빈 입력창에 다시 남아 두 번 보내진다(전형적인 IME 버그)
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    if (listOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(suggestions[activeIndex] ?? suggestions[0])
        return
      }
      if (e.key === 'Escape') {
        // 패널 닫기(Esc)보다 자동완성 닫기가 먼저
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !coarse && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void submit()
      return
    }
    if (e.key === 'ArrowUp' && value === '' && onEditLast) {
      e.preventDefault()
      onEditLast()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!onFiles) return
    const files = [...e.clipboardData.files]
    if (files.length > 0) {
      e.preventDefault()
      onFiles(files)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!onFiles) return
    const files = [...e.dataTransfer.files]
    if (files.length > 0) {
      e.preventDefault()
      onFiles(files)
    }
  }

  const activeOptionId = listOpen ? `${listId}-opt-${activeIndex}` : undefined

  return (
    <div
      // 하단 탭이 없는 대화 화면에서 iOS 홈 바에 입력창이 가리지 않도록 안전 영역을 더한다
      className={cn('relative px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]', className)}
      onDragOver={onFiles ? e => e.preventDefault() : undefined}
      onDrop={onDrop}
    >
      {listOpen && (
        <ul
          id={listId}
          role="listbox"
          aria-label="멘션할 사람"
          className="absolute right-4 bottom-full left-4 z-20 mb-1 max-h-64 overflow-y-auto rounded-w-lg border bg-popover p-1 text-sm shadow-md"
        >
          {suggestions.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={e => {
                e.preventDefault()
                choose(c)
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 h-8 rounded-w-md px-2',
                i === activeIndex && 'bg-accent text-accent-foreground'
              )}
            >
              <span className="max-w-full shrink-0 truncate font-medium">@{c.name}</span>
              {c.title && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">{c.title}</span>
              )}
              {c.status && (
                <span className="min-w-0 truncate text-xs text-muted-foreground" title={c.status}>
                  {c.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-w-lg border bg-background focus-within:border-ring focus-within:ring focus-within:ring-ring/50">
        {quoteSlot}
        {attachmentsSlot}
        <textarea
          ref={ref}
          value={value}
          rows={1}
          disabled={disabled}
          aria-label={label}
          aria-describedby={hintId}
          aria-autocomplete="list"
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={activeOptionId}
          placeholder={placeholder}
          onChange={e => {
            setValue(e.target.value)
            updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
            if (e.target.value.trim()) onTyping?.()
          }}
          onSelect={e => updateMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => {
            composingRef.current = false
            setMention(null)
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="block max-h-60 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-base outline-none md:text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mb-2 flex min-h-8 items-center gap-1 px-2">
          {onAttach && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onAttach}
              disabled={disabled}
              aria-label="파일 첨부"
            >
              <PaperclipIcon aria-hidden="true" />
            </Button>
          )}
          {onCreateDocument && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onCreateDocument}
              disabled={disabled}
              aria-label="새 문서 만들기"
            >
              <FilePlusIcon aria-hidden="true" />
            </Button>
          )}
          <span id={hintId} className="ml-1 hidden text-xs text-muted-foreground sm:inline">
            {coarse
              ? '보내기 버튼으로 전송 · Enter 줄바꿈 · @ 멘션'
              : 'Enter 보내기 · Shift+Enter 줄바꿈 · @ 멘션'}
          </span>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label="보내기"
          >
            <SendHorizontalIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
