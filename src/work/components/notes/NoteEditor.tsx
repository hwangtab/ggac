'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  BoldIcon,
  CheckSquareIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  type LucideIcon,
} from 'lucide-work'
import { CHAT_PROSE_CLASS } from '@work/components/chat/ChatMarkdown'
import MessageMarkdown from '@work/components/markdown/MessageMarkdown'
import { Button } from '@work/components/ui/button'
import { Textarea } from '@work/components/ui/textarea'
import { applyFormat, type NoteFormat } from '@work/lib/notes/format'
import { NOTE_BODY_MAX } from '@work/lib/notes/schema'
import { cn } from '@work/lib/utils'

const TOOLS: { format: NoteFormat; label: string; Icon: LucideIcon }[] = [
  { format: 'heading', label: '제목', Icon: Heading2Icon },
  { format: 'bold', label: '굵게', Icon: BoldIcon },
  { format: 'italic', label: '기울임', Icon: ItalicIcon },
  { format: 'bullet', label: '글머리 목록', Icon: ListIcon },
  { format: 'ordered', label: '번호 목록', Icon: ListOrderedIcon },
  { format: 'task', label: '체크 목록', Icon: CheckSquareIcon },
  { format: 'quote', label: '인용', Icon: QuoteIcon },
  { format: 'code', label: '코드', Icon: CodeIcon },
  { format: 'link', label: '링크', Icon: LinkIcon },
]

/**
 * 메모 마크다운 편집기 — 서식 단추 줄 + 입력칸, "편집 / 미리보기" 전환.
 * 미리보기는 저장된 메모와 같은 MessageMarkdown(raw HTML 비렌더)으로 그린다.
 * Ctrl/⌘+S 는 onSave. 서식 단추는 입력칸의 선택 범위에 적용한다(applyFormat).
 */
export default function NoteEditor({
  value,
  onChange,
  onSave,
  disabled = false,
}: {
  value: string
  onChange: (next: string) => void
  onSave: () => void
  disabled?: boolean
}) {
  const uid = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  function format(f: NoteFormat) {
    const el = ref.current
    if (!el) return
    const res = applyFormat(value, el.selectionStart, el.selectionEnd, f)
    onChange(res.text)
    // 값이 바뀐 뒤(렌더 후) 선택 범위를 되돌린다
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(res.start, res.end)
    })
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-h-10 flex-wrap items-center gap-1">
        <div role="toolbar" aria-label="서식" className="flex flex-wrap items-center gap-1">
          {TOOLS.map(({ format: f, label, Icon }) => (
            <Button
              key={f}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              disabled={disabled || preview}
              onClick={() => format(f)}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>
        <div role="group" aria-label="보기 방식" className="ml-auto flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={preview ? 'outline' : 'default'}
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            편집
          </Button>
          <Button
            type="button"
            size="sm"
            variant={preview ? 'default' : 'outline'}
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            미리보기
          </Button>
        </div>
      </div>

      {preview ? (
        <div
          aria-label="미리보기"
          role="region"
          // 스크롤되는 미리보기라 키보드로 초점을 받아 스크롤할 수 있어야 한다(원본 그대로)
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="min-h-48 flex-1 overflow-y-auto rounded-w-lg border p-4"
        >
          {value.trim() ? (
            <MessageMarkdown content={value} className={`prose-p:my-2 ${CHAT_PROSE_CLASS}`} />
          ) : (
            <p className="text-sm text-muted-foreground">내용이 없습니다.</p>
          )}
        </div>
      ) : (
        <>
          <label htmlFor={`${uid}-body`} className="sr-only">
            메모 내용
          </label>
          <Textarea
            id={`${uid}-body`}
            ref={ref}
            value={value}
            disabled={disabled}
            maxLength={NOTE_BODY_MAX}
            placeholder="마크다운으로 적을 수 있습니다. 예: ## 제목, - 목록, **굵게**"
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            className={cn('min-h-64 flex-1 resize-y font-mono text-sm leading-6')}
          />
        </>
      )}
    </div>
  )
}
