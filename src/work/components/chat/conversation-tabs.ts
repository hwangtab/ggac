import {
  CheckSquareIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  ImageIcon,
  MessageSquareIcon,
  StickyNoteIcon,
  type LucideIcon,
} from 'lucide-work'
import type { ChannelKind } from '@work/lib/channels/types'
import { conversationBasePath, conversationTabHref, customTabKey } from '@work/lib/tabs/paths'
import type { AppTabKind } from '@work/lib/tabs/schema'
import type { ConversationTabItem } from '@work/lib/tabs/types'

export { conversationBasePath, conversationTabHref }

/**
 * 대화(채널·DM·그룹) 상단 가로 탭 정의(순수). 탭 바는 이 목록만 보고 그린다.
 * 경로 규약은 `/c/<slug>/<tabKey>`, `/dm/<id>/<tabKey>`(게시물 탭 = 규약상 `<tabKey>` 없는 기본 경로).
 * 기본 탭(게시물·파일 / 채팅·공유됨)은 상수이고, 추가 탭(웹사이트·할 일·메모·파일 — ggac 이식: 위키 없음)은 DB(work.conversation_tabs)에서 와서
 * 그 뒤에 `t/<tabId>` 로 이어 붙는다(docs/05).
 */
export type ConversationTab = {
  /** 탭 식별자(URL 마지막 구간). 게시물 탭은 'posts' 이고 경로에는 나타나지 않는다. 추가 탭은 `t/<id>` */
  key: string
  label: string
  href: string
  icon: LucideIcon
  /** 추가 탭이면 그 정보(메뉴·권한 판단용). 기본 탭에는 없다 */
  custom?: { id: string; kind: AppTabKind; createdBy: string }
}

export type ConversationRef = {
  id: string
  kind: ChannelKind
  slug: string | null
  isGroup?: boolean
}

const KIND_ICON: Record<AppTabKind, LucideIcon> = {
  file: FileTextIcon,
  note: StickyNoteIcon,
  website: GlobeIcon,
  tasks: CheckSquareIcon,
}

/** 기본 탭: 채널은 게시물 · 파일, DM·그룹은 채팅 · 공유됨. */
export function defaultConversationTabs(c: ConversationRef): ConversationTab[] {
  const base = conversationBasePath(c)
  if (c.kind === 'dm') {
    return [
      {
        key: 'posts',
        label: '채팅',
        href: conversationTabHref(base, 'posts'),
        icon: MessageSquareIcon,
      },
      {
        key: 'shared',
        label: '공유됨',
        href: conversationTabHref(base, 'shared'),
        icon: ImageIcon,
      },
    ]
  }
  return [
    {
      key: 'posts',
      label: '게시물',
      href: conversationTabHref(base, 'posts'),
      icon: MessageSquareIcon,
    },
    { key: 'files', label: '파일', href: conversationTabHref(base, 'files'), icon: FolderIcon },
  ]
}

/** 기본 탭 + 추가 탭(주어진 순서 그대로) */
export function buildConversationTabs(
  c: ConversationRef,
  custom: readonly ConversationTabItem[] = []
): ConversationTab[] {
  const base = conversationBasePath(c)
  return [
    ...defaultConversationTabs(c),
    ...custom.map(t => ({
      key: customTabKey(t.id),
      label: t.title,
      href: conversationTabHref(base, customTabKey(t.id)),
      icon: KIND_ICON[t.kind],
      custom: { id: t.id, kind: t.kind, createdBy: t.createdBy },
    })),
  ]
}
