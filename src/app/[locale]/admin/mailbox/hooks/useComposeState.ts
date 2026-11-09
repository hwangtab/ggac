import { useState, useEffect, useCallback } from 'react'

import { buildForwardText, forwardSubject } from '@/lib/mail/replyCompose'

import type { ForwardSource } from '../ComposeModal'
import type { Attachment, InboundEmailDetail } from '../mailboxTypes'

/** 새 메일 작성·전달 창의 상태와 서버 스위치(작성 가능 여부·일일 한도). */
export function useComposeState({ canManage }: { canManage: boolean }) {
  const [composeTo, setComposeTo] = useState<string[] | undefined>(undefined)
  const [composeForward, setComposeForward] = useState<ForwardSource | undefined>(undefined)
  // 새 메일 작성은 관리자 + 서버 스위치(MAILBOX_COMPOSE_ENABLED)가 모두 켜졌을 때만 그린다.
  const [composeEnabled, setComposeEnabled] = useState(false)
  const [composeQuota, setComposeQuota] = useState<{ used: number; limit: number } | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)

  const fetchComposeMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mailbox/outbound?limit=1')
      if (!res.ok) return
      const json = await res.json()
      setComposeEnabled(json.data?.compose_enabled === true)
      setComposeQuota(json.data?.quota ?? null)
    } catch {
      // 작성 버튼이 안 뜰 뿐이다 — 화면 전체를 막을 일이 아니다.
    }
  }, [])

  useEffect(() => {
    if (canManage) fetchComposeMeta()
  }, [canManage, fetchComposeMeta])

  /** 새 메일 창을 연다. `to`가 있으면 받는 사람을 채운다(발신자 카드의 "메일 쓰기"). */
  const openCompose = (to?: string[]) => {
    setComposeTo(to)
    setComposeForward(undefined)
    setComposeOpen(true)
  }

  const closeCompose = () => {
    setComposeOpen(false)
    setComposeTo(undefined)
    setComposeForward(undefined)
  }

  /** 지금 상세의 메일을 전달 창으로 연다(버튼과 `f` 키가 같이 쓴다). 상세가 다 읽힌 뒤에만 연다. */
  const openForward = (
    detail: InboundEmailDetail | null,
    selectedId: string | null,
    attachments: Attachment[]
  ) => {
    if (!composeEnabled || !detail || detail.id !== selectedId) return
    setComposeTo(undefined)
    setComposeForward({
      emailId: detail.id,
      subject: forwardSubject(detail.subject),
      body: buildForwardText(detail),
      attachments: attachments.map(att => ({
        id: att.id,
        filename: att.filename,
        size_bytes: att.size_bytes,
        // 목록의 첨부 개수와 같은 규칙 — cid로 박힌 이미지는 본문 이미지다.
        inline: att.content_id !== null && (att.content_type ?? '').startsWith('image/'),
      })),
    })
    setComposeOpen(true)
  }

  return {
    composeTo,
    composeForward,
    composeEnabled,
    composeQuota,
    composeOpen,
    fetchComposeMeta,
    openCompose,
    closeCompose,
    openForward,
  }
}

export type ComposeState = ReturnType<typeof useComposeState>
