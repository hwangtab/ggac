'use client'

import type { ReactNode } from 'react'
import type { AttachmentRow } from '@work/lib/messages/types'

/**
 * 입력창 첨부 이음매(메시징 ↔ 파일).
 *
 * ChannelView·ThreadPanel 은 이 훅의 결과를 MessageComposer 에 넘기고, composer 를
 * `<AttachmentPicker uploads={attachments.uploads}>` 로 감싼다(드래그&드롭·붙여넣기·숨은 file input).
 *   - onAttach            첨부 버튼 → 파일 선택 창
 *   - attachmentsSlot     입력창 위 업로드 목록(진행률·제거)
 *   - pendingAttachmentIds 업로드가 끝난 임시 업로드 id(있으면 본문이 비어도 전송 가능)
 *   - sendBlocked         업로드 중이면 전송을 막는다(끝난 것만 붙고 나머지가 남는 일을 막기 위해)
 *   - onSent(messageId)   메시지 저장 직후 임시 업로드를 그 메시지에 확정(attachUploads) →
 *                         결과를 onAttached 로 알려 타임라인의 해당 메시지에 첨부를 그린다
 *   - onFiles             비워 둔다 — 붙여넣기·드롭은 AttachmentPicker 가 받는다(composer 에도 주면 두 번 들어간다)
 */
export type ComposerAttachments = {
  onAttach?: () => void
  attachmentsSlot?: ReactNode
  pendingAttachmentIds?: string[]
  sendBlocked?: boolean
  onSent?: (messageId: string, attachmentIds: string[]) => void | Promise<void>
  onFiles?: (files: File[]) => void
  /** AttachmentPicker 에 넘길 업로드 상태(ggac 1b: 첨부 미지원이라 null) */
  uploads: null
}

/**
 * ggac 이식 1b: 첨부(자료실)는 2단계다. 원본과 같은 모양을 돌려주되 `onAttach`를 주지 않아 입력창의 첨부 단추가 숨고,
 * 업로드 목록·전송 막기도 없다. 2단계에서 원본으로 되돌린다(`port-from-kosmart.mjs --force`).
 */
export function useComposerAttachments(_ctx: {
  channelId: string
  parentId?: string | null
  /** 첨부가 메시지에 확정됐을 때(타임라인 dispatch 'attachments') */
  onAttached?: (messageId: string, attachments: AttachmentRow[]) => void
}): ComposerAttachments {
  return NO_ATTACHMENTS
}

const NO_ATTACHMENTS: ComposerAttachments = { uploads: null }
