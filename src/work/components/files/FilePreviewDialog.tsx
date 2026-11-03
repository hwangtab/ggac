'use client'

import { useEffect, useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from 'lucide-work'
import { Button, buttonVariants } from '@work/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@work/components/ui/dialog'
import { FILE_KIND_LABEL, fileKindOf, formatBytes } from '@work/lib/files/mime'
import FilePreviewBody, { fileUrl, type PreviewFile } from './FilePreviewBody'
import FileIcon from './FileIcon'
import FileVersionControls from './versions/FileVersionControls'

export { fileUrl, namedFileUrl, TextPreview, type PreviewFile } from './FilePreviewBody'

/** 입력 중인 칸(텍스트 선택·커서 이동)에서는 ←/→ 를 가로채지 않는다 */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  // 동영상·오디오 컨트롤에서는 ←/→ 가 감기·볼륨이다 — 이전·다음 파일로 가로채지 않는다
  return (
    t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(t.tagName)
  )
}

/**
 * 미리보기 라이트박스. 본문은 공용 FilePreviewBody(이미지·PDF·동영상·오디오·텍스트·문서·시트, 그 밖은 아이콘 + 다운로드).
 * 키보드(QA #21): ←/→ 이전·다음 파일, Esc 닫기 — 캡처 단계에서 받아 다이얼로그 안 어디에 포커스가
 * 있어도 동작하고, Esc 는 뒤의 우측 패널까지 닫지 않게 여기서 멈춘다.
 */
export default function FilePreviewDialog({
  files,
  index,
  onIndexChange,
  onClose,
}: {
  files: PreviewFile[]
  /** null 이면 닫힘 */
  index: number | null
  onIndexChange: (next: number) => void
  onClose: () => void
}) {
  const file = index === null ? null : (files[index] ?? null)
  const hasPrev = index !== null && index > 0
  const hasNext = index !== null && index < files.length - 1

  // 최신 콜백을 ref 로 — 리스너를 index 마다 다시 달지 않는다
  const latest = useRef({ index, count: files.length, onIndexChange, onClose })
  latest.current = { index, count: files.length, onIndexChange, onClose }
  const open = index !== null

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      const { index: i, count, onIndexChange: go, onClose: closeIt } = latest.current
      if (i === null || e.isComposing) return
      // 버전 기록·수정본 저장 같은 위의 대화상자가 열려 있으면 그쪽이 키를 받는다
      if (document.querySelectorAll('[data-slot="dialog-content"]').length > 1) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeIt()
        return
      }
      if (isTypingTarget(e.target) || e.altKey || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault()
        go(i - 1)
      } else if (e.key === 'ArrowRight' && i < count - 1) {
        e.preventDefault()
        go(i + 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const kind = file ? fileKindOf(file.mime, file.name, file.size) : 'other'

  return (
    <Dialog open={file !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex h-[min(90dvh,900px)] w-[min(96vw,1100px)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none">
        {file && (
          <>
            <div className="flex min-h-12 items-center gap-2 pr-10">
              <FileIcon mime={file.mime} name={file.name} size={file.size} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate">{file.name}</DialogTitle>
                <DialogDescription>
                  {FILE_KIND_LABEL[kind]} · {formatBytes(file.size)}
                </DialogDescription>
              </div>
              <a
                href={fileUrl(file.id, { download: true })}
                download={file.name}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <DownloadIcon aria-hidden="true" />
                다운로드
              </a>
            </div>

            <FileVersionControls key={file.id} attachmentId={file.id} fileName={file.name} />

            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-w-lg bg-subtle">
              <FilePreviewBody key={file.id} file={file} />

              {hasPrev && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-1/2 left-2 -translate-y-1/2"
                  aria-label="이전 파일"
                  onClick={() => onIndexChange(index! - 1)}
                >
                  <ChevronLeftIcon aria-hidden="true" />
                </Button>
              )}
              {hasNext && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-1/2 right-2 -translate-y-1/2"
                  aria-label="다음 파일"
                  onClick={() => onIndexChange(index! + 1)}
                >
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
