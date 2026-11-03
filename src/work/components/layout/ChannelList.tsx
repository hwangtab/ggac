'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from '@work/lib/nav/link'
import {
  BotIcon,
  CheckIcon,
  HashIcon,
  LockIcon,
  ArrowUpToLineIcon,
  ArrowDownToLineIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-work'
import { cn } from '@work/lib/utils'
import { isBotChannel } from '@work/lib/channels/sections'
import DraftMark from '@work/components/chat/DraftMark'
import { channelHref, type ChannelListItem } from './channel-items'
import { CHANNEL_DRAG_TYPE } from './drag-types'
import { EmptyState } from './page'
import { COUNT_BADGE_CLASS, ROW_ACTIVE_CLASS, ROW_CLASS, UNREAD_DOT_CLASS } from './pane-styles'

export type { ChannelListItem } from './channel-items'

/**
 * 채널 카테고리 이동(0044, 관리자). 주면 우클릭·길게 누르기 메뉴에 "카테고리 이동" 항목이 생기고, 행을 끌 수 있다.
 * options 의 id 가 null 인 항목이 "기타". 저장은 호출한 쪽이 한다.
 */
export type CategoryMenu = {
  options: { id: string | null; label: string }[]
  onMove: (item: ChannelListItem, categoryId: string | null) => void
  /** 끌기 시작·끝 — 섹션이 빈 "기타" 드롭 영역을 잠깐 보이는 데 쓴다 */
  onDragStateChange?: (dragging: boolean) => void
}

/**
 * 사이드바 채널 목록 — **순수 컴포넌트**(데이터 조회 없음). 메시징 영역이 items 를 채운다.
 * 고정(핀): `onTogglePin` 을 주면 항목에 마우스를 올리거나 포커스할 때 고정 버튼이 보이고(터치 기기는 항상),
 * 우클릭하면 "상단에 고정 / 고정 해제" 메뉴가 열린다. 저장은 호출한 쪽이 한다(여기선 핸들러만 부른다).
 * 읽지 않음이 있으면 굵게, 멘션이 있으면 숫자 배지. 현재 채널은 aria-current="page".
 */
export default function ChannelList({
  items,
  activeId,
  label,
  labelledBy,
  emptyText,
  onNavigate,
  onTogglePin,
  categoryMenu,
}: {
  items: ChannelListItem[]
  activeId?: string | null
  /** 목록 aria-label(섹션 제목과 같게) */
  label: string
  /** 주면 aria-label 대신 이 id 의 요소(섹션 헤더 버튼)로 이름을 붙인다 */
  labelledBy?: string
  emptyText?: string
  /** 모바일 드로어에서 항목을 누르면 드로어를 닫는 데 쓴다 */
  onNavigate?: () => void
  /** 주면 고정 버튼·우클릭 메뉴가 생긴다. next = 바꿀 고정 상태 */
  onTogglePin?: (item: ChannelListItem, next: boolean) => void
  /** 주면 카테고리 이동 메뉴·끌어다 놓기가 생긴다(채널 행만 — DM 제외) */
  categoryMenu?: CategoryMenu
}) {
  const menuEnabled = !!onTogglePin || !!categoryMenu
  const [menu, setMenu] = useState<{ item: ChannelListItem; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  })
  const menuId = menu?.item.id

  /** 메뉴를 닫는다. restore 면 포커스를 연 항목으로 돌려준다(고정하면 항목이 다른 목록으로 옮겨 가므로 id 로 다시 찾는다) */
  const closeMenu = useCallback((restore: boolean, id?: string) => {
    setMenu(null)
    if (!restore || !id) return
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`a[data-channel-id="${CSS.escape(id)}"]`)?.focus()
    })
  }, [])

  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu(true, menuId)
    }
    const close = () => closeMenu(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
    // menu 객체가 아니라 열린 항목이 바뀔 때만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId, closeMenu])

  // 화면 끝에서 열면 뷰포트 안으로 밀어 넣는다
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const margin = 8
    const { width, height } = el.getBoundingClientRect()
    const x = Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin))
    const y = Math.max(margin, Math.min(menu.y, window.innerHeight - height - margin))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [menu])

  function cancelLongPress() {
    if (longPress.current.timer) clearTimeout(longPress.current.timer)
    longPress.current.timer = null
  }

  if (items.length === 0) {
    return emptyText ? <EmptyState compact title={emptyText} /> : null
  }
  return (
    <>
      <ul
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        className="space-y-px"
      >
        {items.map(item => {
          const active = item.id === activeId
          const hasUnread = item.unread > 0 && !item.muted
          const bot = item.kind !== 'dm' && isBotChannel(item.slug)
          const Icon = bot
            ? BotIcon
            : item.kind === 'dm'
              ? item.group
                ? UsersIcon
                : UserIcon
              : item.kind === 'private'
                ? LockIcon
                : HashIcon
          const mentions = item.mentions ?? 0
          // 배지(§8-4, 메뉴 '대화' 배지와 같은 규칙 — menuBadges.ts): 나를 부른 것 = 앰버 숫자.
          // 채널은 멘션, 뮤트 아닌 DM·그룹은 안 읽은 글 전부가 나를 부른 것이다. 그 밖의 안 읽음은 굵은 글자 + 앰버 점
          const urgent =
            item.kind === 'dm' && !item.muted ? Math.max(item.unread, mentions) : mentions
          const showDot = hasUnread && urgent === 0
          // 상태 메시지는 1:1 DM 상대에게만 붙는다(0027)
          const statusLabel =
            item.kind === 'dm' && !item.group
              ? [item.statusEmoji, item.statusText].filter(Boolean).join(' ')
              : ''
          // 접속 점은 1:1 DM 에만(그룹·채널은 표시하지 않는다)
          const showOnline = item.kind === 'dm' && !item.group && item.online === true
          const srState = [
            bot ? '운영 봇' : null,
            item.kind === 'private'
              ? '비공개'
              : item.kind === 'dm'
                ? item.group
                  ? '그룹 채팅'
                  : '다이렉트 메시지'
                : null,
            showOnline ? '접속 중' : null,
            statusLabel ? `상태: ${statusLabel}` : null,
            hasUnread ? `읽지 않은 메시지 ${item.unread}개` : null,
            mentions > 0 ? `멘션 ${mentions}개` : null,
          ]
            .filter(Boolean)
            .join(', ')
          return (
            <li
              key={item.id}
              className="group relative"
              draggable={categoryMenu && item.kind !== 'dm' ? true : undefined}
              onDragStart={
                categoryMenu && item.kind !== 'dm'
                  ? e => {
                      e.dataTransfer.setData(CHANNEL_DRAG_TYPE, item.id)
                      e.dataTransfer.effectAllowed = 'move'
                      categoryMenu.onDragStateChange?.(true)
                    }
                  : undefined
              }
              onDragEnd={
                categoryMenu && item.kind !== 'dm'
                  ? () => categoryMenu.onDragStateChange?.(false)
                  : undefined
              }
              onContextMenu={
                menuEnabled
                  ? e => {
                      e.preventDefault()
                      setMenu({ item, x: e.clientX, y: e.clientY })
                    }
                  : undefined
              }
              onTouchStart={
                menuEnabled
                  ? e => {
                      const t = e.touches[0]
                      cancelLongPress()
                      longPress.current.fired = false
                      longPress.current.timer = setTimeout(() => {
                        longPress.current.fired = true
                        setMenu({ item, x: t.clientX, y: t.clientY })
                      }, 500)
                    }
                  : undefined
              }
              onTouchMove={menuEnabled ? cancelLongPress : undefined}
              onTouchEnd={menuEnabled ? cancelLongPress : undefined}
              onTouchCancel={menuEnabled ? cancelLongPress : undefined}
            >
              <Link
                href={channelHref(item)}
                data-channel-id={item.id}
                draggable={categoryMenu && item.kind !== 'dm' ? false : undefined}
                onClick={e => {
                  // 길게 눌러 메뉴를 열었으면 이어지는 클릭은 이동하지 않는다
                  if (longPress.current.fired) {
                    longPress.current.fired = false
                    e.preventDefault()
                    return
                  }
                  onNavigate?.()
                }}
                aria-current={active ? 'page' : undefined}
                data-unread={hasUnread || undefined}
                className={cn(
                  ROW_CLASS,
                  '[-webkit-touch-callout:none]',
                  // 고정 버튼(absolute)이 배지·접속 점·상태 이모지를 가리지 않게 오른쪽 자리를 비워 둔다
                  onTogglePin && 'pr-8 pointer-coarse:pr-11',
                  hasUnread && 'font-semibold text-unread',
                  // 뮤트: 투명도 대신 흐린 글자색(opacity-60 은 대비 2.96:1 로 AA 미달)
                  item.muted && 'text-muted-foreground',
                  active && ROW_ACTIVE_CLASS
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <DraftMark channelId={item.id} />
                {statusLabel && (
                  <span
                    aria-hidden="true"
                    data-status="true"
                    data-tooltip={statusLabel}
                    className="shrink-0 text-xs"
                  >
                    {item.statusEmoji || '💬'}
                  </span>
                )}
                {showOnline && (
                  <span
                    aria-hidden="true"
                    data-presence="online"
                    className="size-2 shrink-0 rounded-w-lg bg-online"
                  />
                )}
                {srState && <span className="sr-only">({srState})</span>}
                {urgent > 0 ? (
                  <span
                    aria-hidden="true"
                    data-badge="mention"
                    className={cn(COUNT_BADGE_CLASS, 'ml-auto')}
                  >
                    {urgent > 99 ? '99+' : urgent}
                  </span>
                ) : (
                  showDot && (
                    <span
                      aria-hidden="true"
                      data-badge="dot"
                      className={cn(UNREAD_DOT_CLASS, 'ml-auto')}
                    />
                  )
                )}
              </Link>
              {onTogglePin && (
                <button
                  type="button"
                  onClick={() => onTogglePin(item, !item.starred)}
                  aria-label={`${item.name} ${item.starred ? '고정 해제' : '상단에 고정'}`}
                  className={cn(
                    'absolute top-1 right-1 flex size-6 items-center justify-center rounded-w-lg text-sidebar-foreground/70 outline-none pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:size-11',
                    'hover:bg-sidebar-border hover:text-sidebar-accent-foreground',
                    'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
                    item.starred && 'text-sidebar-foreground'
                  )}
                >
                  {item.starred ? (
                    <ArrowDownToLineIcon aria-hidden="true" className="size-3.5" />
                  ) : (
                    <ArrowUpToLineIcon aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {menu && menuEnabled && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40"
            onClick={() => closeMenu(true, menu.item.id)}
            onContextMenu={e => {
              e.preventDefault()
              closeMenu(true, menu.item.id)
            }}
          />
          {/* 메뉴 자체가 아니라 안의 menuitem 단추가 포커스를 받는다(열 때 첫 항목으로 옮긴다) — 원본 그대로 */}
          {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={e => {
              // Tab 으로 메뉴를 벗어나면 닫고 포커스를 항목으로 돌려 거기서부터 이어 가게 한다
              if (e.key === 'Tab') closeMenu(true, menu.item.id)
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const entries = [
                  ...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
                ]
                const at = entries.indexOf(document.activeElement as HTMLElement)
                const step = e.key === 'ArrowDown' ? 1 : -1
                entries[(at + step + entries.length) % entries.length]?.focus()
              }
            }}
            aria-label={`${menu.item.name} 메뉴`}
            style={{ left: menu.x, top: menu.y }}
            className="fixed z-50 min-w-36 rounded-w-lg bg-popover p-1 text-popover-foreground border border-border"
          >
            {onTogglePin && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onTogglePin(menu.item, !menu.item.starred)
                  closeMenu(true, menu.item.id)
                }}
                className="flex h-8 pointer-coarse:h-11 w-full items-center gap-2 rounded-w-lg px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              >
                {menu.item.starred ? (
                  <ArrowDownToLineIcon aria-hidden="true" className="size-4" />
                ) : (
                  <ArrowUpToLineIcon aria-hidden="true" className="size-4" />
                )}
                {menu.item.starred ? '고정 해제' : '상단에 고정'}
              </button>
            )}
            {categoryMenu && menu.item.kind !== 'dm' && (
              <div role="group" aria-label="카테고리 이동">
                <p aria-hidden="true" className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
                  카테고리 이동
                </p>
                {categoryMenu.options.map(opt => {
                  const current = (menu.item.categoryId ?? null) === opt.id
                  return (
                    <button
                      key={opt.id ?? 'other'}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      onClick={() => {
                        if (!current) categoryMenu.onMove(menu.item, opt.id)
                        closeMenu(true, menu.item.id)
                      }}
                      className="flex h-8 pointer-coarse:h-11 w-full items-center gap-2 rounded-w-lg px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                    >
                      <span className="flex size-4 items-center justify-center">
                        {current && <CheckIcon aria-hidden="true" className="size-4" />}
                      </span>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
