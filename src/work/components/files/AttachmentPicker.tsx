'use client'

import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { UploadCloudIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'
import type { AttachmentUploads } from './useAttachmentUploads'

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/**
 * 첨부 입력 래퍼 — composer 를 감싸면 드래그&드롭·붙여넣기·파일 선택(숨은 <input>)을 한 곳에서 처리한다.
 * 파일 선택 창은 `uploads.openFileDialog()` (MessageComposer 의 onAttach 에 연결).
 *
 *   <AttachmentPicker uploads={uploads}>
 *     <MessageComposer onAttach={uploads.openFileDialog} ... />
 *   </AttachmentPicker>
 */
export default function AttachmentPicker({
  uploads,
  children,
  className,
  disabled = false,
}: {
  uploads: AttachmentUploads
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  // dragenter/leave 는 자식 요소마다 발생하므로 깊이를 센다.
  const depth = useRef(0)

  function onDragEnter(e: DragEvent) {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current += 1
    setDragging(true)
  }
  function onDragOver(e: DragEvent) {
    if (disabled || !hasFiles(e)) return
    e.preventDefault() // drop 허용
    e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: DragEvent) {
    if (disabled || !hasFiles(e)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }
  function onDrop(e: DragEvent) {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    uploads.addFiles(Array.from(e.dataTransfer.files))
  }
  function onPaste(e: ClipboardEvent) {
    if (disabled) return
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length === 0) return // 텍스트 붙여넣기는 그대로 둔다
    e.preventDefault()
    uploads.addFiles(files)
  }

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <input
        ref={uploads.inputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-label="파일 선택"
        data-testid="attachment-input"
        onChange={uploads.onInputChange}
      />
      {children}
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-w-lg border-2 border-dashed border-primary bg-background text-sm font-medium text-primary"
        >
          <UploadCloudIcon className="size-5" />
          파일을 여기에 놓으면 첨부됩니다
        </div>
      )}
    </div>
  )
}
