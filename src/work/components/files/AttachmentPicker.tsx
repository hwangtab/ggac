import type { ReactNode } from 'react'

/**
 * ggac 이식 1b 자리표시 — 첨부 업로드(드래그·붙여넣기·파일 선택)는 2단계에서 원본
 * `components/files/AttachmentPicker.tsx`로 바꾼다. 지금은 입력창을 그대로 그린다
 * (`use-composer-attachments`가 `onAttach`를 주지 않아 첨부 단추도 숨는다).
 */
export default function AttachmentPicker({
  children,
}: {
  uploads?: unknown
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return <>{children}</>
}
