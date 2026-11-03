'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'
import {
  groupChannelsByCategory,
  moveCategoryBefore,
  OTHER_CATEGORY,
  reorderedCategoryIds,
  type ChannelCategory,
} from '@work/lib/channels/sections'
import ChannelList, { type CategoryMenu as ChannelCategoryMenu } from './ChannelList'
import CategoryMenu, { CategoryNameDialog } from './CategoryMenu'
import { CATEGORY_DRAG_TYPE, CHANNEL_DRAG_TYPE } from './drag-types'
import { COUNT_BADGE_CLASS, UNREAD_DOT_CLASS } from './pane-styles'
import type { ChannelListItem } from './channel-items'
import type { CategoryOps } from './shell-context'

/** 접어 둔 카테고리 key(id 또는 'other') 배열(JSON)을 기억한다. 저장소가 막힌 환경에서는 기억만 포기한다 */
export const SECTIONS_COLLAPSED_KEY = 'kw-channel-sections-collapsed'

function readCollapsed(): string[] {
  try {
    const raw = window.localStorage.getItem(SECTIONS_COLLAPSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function writeCollapsed(keys: string[]): void {
  try {
    window.localStorage.setItem(SECTIONS_COLLAPSED_KEY, JSON.stringify(keys))
  } catch {
    // 저장 불가 환경 — 이번 화면에서만 유지
  }
}

/** 카테고리 안 읽지 않은 합계(뮤트한 채널 제외 — ChannelList 의 강조 기준과 같다) */
/** 묶음의 "나를 부른 것" 수 — 채널은 멘션, 뮤트 아닌 DM·그룹은 안 읽음 전부(menuBadges.ts와 같은 규칙) */
export function sectionUrgent(
  items: Pick<ChannelListItem, 'unread' | 'muted' | 'mentions' | 'kind'>[]
): number {
  return items.reduce((sum, i) => {
    const mentions = i.mentions ?? 0
    return sum + (i.kind === 'dm' && !i.muted ? Math.max(i.unread, mentions) : mentions)
  }, 0)
}

export function sectionUnread(items: Pick<ChannelListItem, 'unread' | 'muted'>[]): number {
  return items.reduce((sum, i) => (i.muted ? sum : sum + i.unread), 0)
}

/**
 * 채널을 DB 카테고리(0044)별로 묶어 그린다(접기·펼치기). 카테고리가 없으면 "기타" 한 묶음.
 * 접힌 카테고리도 헤더 배지에 읽지 않은 합계를 보여 준다. 데스크톱 목록 패널과 모바일 `/c` 화면이 함께 쓴다.
 * 첫 렌더는 모두 펼침(SSR 과 같게) → 마운트 뒤 저장된 접힘 상태를 적용한다.
 *
 * 관리자(`categoryOps` 를 받으면): 채널 행을 다른 카테고리 영역에 끌어 놓아 옮기고, 카테고리 머리글을 끌어 순서를 바꾼다.
 * 키보드·모바일 대체 경로는 채널 우클릭/길게 누르기 메뉴의 "카테고리 이동"과 머리글 ⋯ 메뉴(이름 바꾸기·위로·아래로·삭제).
 * 빈 카테고리도 관리자에게는 보인다(놓을 자리). 목록 끝 "새 카테고리" 버튼.
 */
export default function ChannelSections({
  items,
  allItems,
  categories = [],
  activeId,
  onNavigate,
  onTogglePin,
  categoryOps,
}: {
  items: ChannelListItem[]
  /** 끌어 온 채널을 찾을 전체 목록(고정됨 묶음 포함). 없으면 items */
  allItems?: ChannelListItem[]
  categories?: ChannelCategory[]
  activeId?: string | null
  onNavigate?: () => void
  onTogglePin?: (item: ChannelListItem, next: boolean) => void
  categoryOps?: CategoryOps
}) {
  const baseId = useId()
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const canManage = !!categoryOps

  useEffect(() => {
    setCollapsed(readCollapsed())
  }, [])

  function toggle(key: string) {
    setCollapsed(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      writeCollapsed(next)
      return next
    })
  }

  const groups = useMemo(() => {
    const grouped = groupChannelsByCategory(items, categories, { includeEmpty: canManage })
    // 끄는 동안에는 비어 있는 "기타"도 놓을 자리로 보인다
    if (canManage && dragging && !grouped.some(g => g.id === null)) {
      grouped.push({ key: OTHER_CATEGORY.key, id: null, label: OTHER_CATEGORY.label, items: [] })
    }
    return grouped
  }, [items, categories, canManage, dragging])

  const categoryMenu = useMemo<ChannelCategoryMenu | undefined>(
    () =>
      categoryOps
        ? {
            options: [
              ...categories.map(c => ({ id: c.id as string | null, label: c.name })),
              { id: null, label: OTHER_CATEGORY.label },
            ],
            onMove: categoryOps.moveChannel,
            onDragStateChange: next => {
              setDragging(next)
              if (!next) setDropKey(null)
            },
          }
        : undefined,
    [categoryOps, categories]
  )

  const lookup = allItems ?? items

  function onDragOver(e: React.DragEvent, key: string, id: string | null) {
    const types = Array.from(e.dataTransfer.types)
    const isChannel = types.includes(CHANNEL_DRAG_TYPE)
    const isCategory = types.includes(CATEGORY_DRAG_TYPE)
    if (!isChannel && !(isCategory && id !== null)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropKey !== key) setDropKey(key)
  }

  function onDrop(e: React.DragEvent, id: string | null) {
    if (!categoryOps) return
    const channelId = e.dataTransfer.getData(CHANNEL_DRAG_TYPE)
    const categoryId = e.dataTransfer.getData(CATEGORY_DRAG_TYPE)
    setDropKey(null)
    setDragging(false)
    if (channelId) {
      e.preventDefault()
      const item = lookup.find(i => i.id === channelId)
      if (item) categoryOps.moveChannel(item, id)
    } else if (categoryId && id !== null) {
      e.preventDefault()
      const ids = moveCategoryBefore(categories, categoryId, id)
      if (ids) categoryOps.reorderCategories(ids)
    }
  }

  return (
    <>
      {groups.map(group => {
        const open = !collapsed.includes(group.key)
        const unread = sectionUnread(group.items)
        const urgent = sectionUrgent(group.items)
        const headerId = `${baseId}-${group.key}-h`
        const bodyId = `${baseId}-${group.key}-b`
        const Chevron = open ? ChevronDownIcon : ChevronRightIcon
        const category = group.id ? categories.find(c => c.id === group.id) : undefined
        const manageable = canManage && !!category
        const order = [...categories].sort(
          (a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ko')
        )
        const index = order.findIndex(c => c.id === group.id)
        return (
          <section
            key={group.key}
            data-section={group.key}
            onDragOver={canManage ? e => onDragOver(e, group.key, group.id) : undefined}
            onDragLeave={
              canManage
                ? e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDropKey(cur => (cur === group.key ? null : cur))
                    }
                  }
                : undefined
            }
            onDrop={canManage ? e => onDrop(e, group.id) : undefined}
            className={cn(
              'rounded-w-lg',
              dropKey === group.key && 'bg-sidebar-accent/60 ring-2 ring-sidebar-ring'
            )}
          >
            <div
              className="group/cat relative pt-3"
              draggable={manageable ? true : undefined}
              onDragStart={
                manageable && group.id
                  ? e => {
                      e.dataTransfer.setData(CATEGORY_DRAG_TYPE, group.id as string)
                      e.dataTransfer.effectAllowed = 'move'
                    }
                  : undefined
              }
            >
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => toggle(group.key)}
                  className={cn(
                    'flex h-7 pointer-coarse:h-11 w-full items-center gap-1 rounded-w-lg px-3 text-xs font-semibold tracking-wide text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    manageable && 'pr-8 pointer-coarse:pr-11'
                  )}
                >
                  <Chevron aria-hidden="true" className="size-3.5 shrink-0" />
                  <span id={headerId} className="min-w-0 flex-1 truncate text-left">
                    {group.label}
                  </span>
                  {/* 접힌 묶음만 알린다(펼친 묶음은 행마다 보인다). 메뉴·행 배지와 같은 규칙(§8-4) —
                      나를 부른 것이 있으면 앰버 숫자, 아니면 앰버 점 */}
                  {unread > 0 && !open && (
                    <span data-section-unread={unread} className="ml-auto flex items-center">
                      {urgent > 0 ? (
                        <span aria-hidden="true" data-badge="mention" className={COUNT_BADGE_CLASS}>
                          {urgent > 99 ? '99+' : urgent}
                        </span>
                      ) : (
                        <span aria-hidden="true" data-badge="dot" className={UNREAD_DOT_CLASS} />
                      )}
                      <span className="sr-only">
                        읽지 않은 메시지 {unread}개
                        {urgent > 0 ? `, 나를 부른 메시지 ${urgent}개` : ''}
                      </span>
                    </span>
                  )}
                </button>
              </h3>
              {manageable && category && categoryOps && (
                <CategoryMenu
                  name={category.name}
                  channelCount={group.items.length}
                  canMoveUp={index > 0}
                  canMoveDown={index >= 0 && index < order.length - 1}
                  onRename={async name => {
                    const res = await categoryOps.renameCategory(category.id, name)
                    return res.ok ? null : res.error
                  }}
                  onMove={direction => {
                    const ids = reorderedCategoryIds(categories, category.id, direction)
                    if (ids) categoryOps.reorderCategories(ids)
                  }}
                  onDelete={async () => {
                    const res = await categoryOps.deleteCategory(category.id)
                    return res.ok ? null : res.error
                  }}
                  className="absolute top-3.5 right-1 pointer-coarse:top-2 [@media(hover:hover)]:opacity-0 group-focus-within/cat:[@media(hover:hover)]:opacity-100 group-hover/cat:[@media(hover:hover)]:opacity-100 focus-visible:[@media(hover:hover)]:opacity-100"
                />
              )}
            </div>
            <div id={bodyId} hidden={!open}>
              {group.items.length === 0 && canManage ? (
                <p className="px-3 py-1 text-xs text-muted-foreground">
                  비어 있음 — 채널을 끌어다 놓거나 채널 메뉴에서 옮기세요.
                </p>
              ) : (
                <ChannelList
                  items={group.items}
                  activeId={activeId}
                  label={group.label}
                  labelledBy={headerId}
                  onNavigate={onNavigate}
                  onTogglePin={onTogglePin}
                  categoryMenu={categoryMenu}
                />
              )}
            </div>
          </section>
        )
      })}
      {categoryOps && (
        <>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="mt-2 flex h-8 w-full items-center gap-1 rounded-w-lg px-3 text-xs text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground pointer-coarse:h-11"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />새 카테고리
          </button>
          <CategoryNameDialog
            open={newOpen}
            title="새 카테고리"
            submitLabel="만들기"
            onSubmit={async name => {
              const res = await categoryOps.createCategory(name)
              return res.ok ? null : res.error
            }}
            onClose={() => setNewOpen(false)}
          />
        </>
      )}
    </>
  )
}
