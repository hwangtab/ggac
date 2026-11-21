import { useEffect, useRef, useState, type RefObject } from 'react'

import { mailboxShortcut } from '../shortcuts'
import type { InboundEmail } from '../mailboxTypes'

type ShortcutDeps = {
  canManage: boolean
  /** 답장·작성·관리 창 중 하나라도 열려 있나. */
  modalOpen: boolean
  view: 'inbox' | 'sent'
  emails: InboundEmail[]
  selectedId: string | null
  selectedEmail: InboundEmail | null
  selectedReplyAllCount: number
  searchInputRef: RefObject<HTMLInputElement | null>
  selectEmail: (email: Pick<InboundEmail, 'id' | 'status'>) => void
  closeDetail: () => void
  toggleChecked: (id: string) => void
  updateStatus: (email: Pick<InboundEmail, 'id' | 'status'>, status: InboundEmail['status']) => void
  openReply: (email: InboundEmail, all?: boolean) => void
  openForward: () => void
}

/**
 * 키보드 단축키 — 판정은 순수 함수(`shortcuts.ts`)가 하고, 여기서는 동작만 잇는다. 리스너는 한 번만 달고 최신
 * 상태는 ref로 읽는다(렌더마다 다시 달지 않게). 도움말 창(`?`)의 열림 상태도 여기서 갖는다.
 */
export function useMailboxShortcuts(deps: ShortcutDeps) {
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const shortcutHandler = useRef<(event: KeyboardEvent) => void>(() => undefined)
  shortcutHandler.current = (event: KeyboardEvent) => {
    const {
      canManage,
      modalOpen,
      view,
      emails,
      selectedId,
      selectedEmail,
      selectedReplyAllCount,
      searchInputRef,
      selectEmail,
      closeDetail,
      toggleChecked,
      updateStatus,
      openReply,
      openForward,
    } = deps
    if (shortcutHelpOpen) {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault()
        setShortcutHelpOpen(false)
      }
      return
    }
    const action = mailboxShortcut(
      {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: event.target instanceof HTMLElement ? event.target : null,
      },
      { canManage, modalOpen }
    )
    if (!action) return
    // 보낸 편지함에는 목록 단축키가 없다 — 도움말(`?`)만 어디서나 연다.
    if (action !== 'help' && view !== 'inbox') return
    event.preventDefault()
    const index = emails.findIndex(e => e.id === selectedId)
    const current = selectedEmail
    const go = (target: InboundEmail | undefined) => {
      if (!target) return
      selectEmail(target)
      document.querySelector(`[data-mail-id="${target.id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    switch (action) {
      case 'next':
        go(emails[index < 0 ? 0 : index + 1])
        break
      case 'prev':
        go(emails[index < 0 ? 0 : index - 1])
        break
      case 'close':
        closeDetail()
        break
      case 'search':
        searchInputRef.current?.focus()
        break
      case 'help':
        setShortcutHelpOpen(true)
        break
      case 'toggle-select':
        if (selectedId) toggleChecked(selectedId)
        break
      case 'archive':
        if (current) updateStatus(current, 'archived')
        break
      case 'spam':
        if (current) updateStatus(current, 'spam')
        break
      case 'reply':
        if (current) openReply(current)
        break
      case 'reply-all':
        if (current && selectedReplyAllCount > 0) openReply(current, true)
        break
      case 'forward':
        openForward()
        break
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutHandler.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return { shortcutHelpOpen, setShortcutHelpOpen }
}
