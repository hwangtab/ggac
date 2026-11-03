'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from '@work/lib/nav/link'
import { usePathname, useSearchParams } from '@work/lib/nav/navigation'
import { ChevronRightIcon, FolderIcon, HashIcon, LibraryIcon, LockIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'
import { groupChannelsForPane } from '@work/lib/channels/sort'
import { filesFolderHref, type ChannelFolder } from '@work/lib/files/channel-files'
import { listChannelFolders } from '@work/lib/files/folder-actions'
import { folderCrumbs, parseFolderParam } from '@work/lib/files/folders'
import type { ChannelListItem } from './channel-items'
import { useShellData } from './shell-context'
import { ROW_ACTIVE_CLASS, ROW_CLASS, TREE_ROW_CLASS } from './pane-styles'
import SubTitle from './SubTitle'
import { EmptyState } from './page'

/** 셸 공통 청크에 SaveVersionDialog·업로드·마크다운이 딸려 들어가지 않게 지연 로드한다(목록 아래 보조 영역). */
const MyEditingSection = dynamic(() => import('@work/components/files/versions/MyEditingSection'), {
  ssr: false,
})

/** 펼친 노드 키 목록(JSON)을 탭 안에서만 기억한다. 저장소가 막힌 환경에서는 기억만 포기한다 */
export const FILES_TREE_EXPANDED_KEY = 'kw-files-tree-expanded'

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ok'; folders: ChannelFolder[] }

/** 노드 키 = `<채널 id>:<폴더 경로>` (채널 루트는 경로가 빈 문자열). uuid 에는 ':' 가 없다 */
const nodeKey = (channelId: string, path: string) => `${channelId}:${path}`

function readExpanded(): string[] {
  try {
    const raw = window.sessionStorage.getItem(FILES_TREE_EXPANDED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function writeExpanded(keys: string[]): void {
  try {
    window.sessionStorage.setItem(FILES_TREE_EXPANDED_KEY, JSON.stringify(keys))
  } catch {
    // 저장 불가 환경 — 이번 화면에서만 유지
  }
}

const linkClass =
  'flex h-full min-w-0 flex-1 items-center gap-2 rounded-w-md pr-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring'

/**
 * 자료실 목록 패널 — "전체 파일" + 채널 → 이관 원본 폴더 트리(설계 03 §2-1).
 * 접근성: ARIA tree 대신 "버튼(aria-expanded) + 중첩 목록" 공개 패턴이다(링크와 펼침 단추가 따로 탭 순서에 든다).
 * 폴더는 펼칠 때 서버 액션(`listChannelFolders`)으로 한 폴더씩 지연 로드한다(RLS 가 권한을 정한다).
 * 현재 URL(`?channel=&path=`)의 채널·폴더와 그 조상은 자동으로 펼치고 `aria-current` 로 표시한다.
 */
export default function FilesPaneContent({
  channels,
  isGuest = false,
}: {
  /** 내가 멤버인 채널(DM 제외) */
  channels: ChannelListItem[]
  /** 게스트는 "전체 파일"을 숨긴다(전역 자료실은 내부 구성원 전용) */
  isGuest?: boolean
}) {
  const pathname = usePathname() ?? '/'
  const params = useSearchParams()
  const activeChannel = pathname === '/files' ? (params?.get('channel') ?? null) : null
  const activePath = activeChannel ? (parseFolderParam(params?.get('path') ?? undefined) ?? '') : ''
  // 폴더 파일 수는 "최신 버전만" 센다(DB channel_subfolders, 0032) — 이전 버전까지 보는 ?versions=all 에서는 목록과 어긋나므로 숨긴다.
  const showCounts = params?.get('versions') !== 'all'

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loads, setLoads] = useState<Record<string, Load>>({})
  const requested = useRef<Set<string>>(new Set())
  const restored = useRef(false)

  const load = useCallback((channelId: string, path: string) => {
    const key = nodeKey(channelId, path)
    if (requested.current.has(key)) return
    requested.current.add(key)
    setLoads(prev => ({ ...prev, [key]: { status: 'loading' } }))
    listChannelFolders({ channelId, path })
      .then(res => {
        if (!res.ok) throw new Error(res.error)
        setLoads(prev => ({ ...prev, [key]: { status: 'ok', folders: res.data } }))
      })
      .catch(() => {
        requested.current.delete(key)
        setLoads(prev => ({ ...prev, [key]: { status: 'error' } }))
      })
  }, [])

  // 마운트 뒤 저장된 펼침 상태를 되살린다(첫 렌더는 SSR 과 같게 모두 접힘)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const saved = readExpanded()
    if (saved.length > 0) setExpanded(prev => new Set([...prev, ...saved]))
  }, [])

  // 현재 위치의 채널과 폴더 조상은 자동으로 펼친다
  useEffect(() => {
    if (!activeChannel) return
    const keys = [
      nodeKey(activeChannel, ''),
      ...folderCrumbs(activePath).map(c => nodeKey(activeChannel, c.path)),
    ]
    setExpanded(prev => {
      if (keys.every(k => prev.has(k))) return prev
      return new Set([...prev, ...keys])
    })
  }, [activeChannel, activePath])

  // 펼쳐진 노드는 아직 안 불러왔으면 불러온다
  useEffect(() => {
    for (const key of expanded) {
      const i = key.indexOf(':')
      load(key.slice(0, i), key.slice(i + 1))
    }
    if (restored.current) writeExpanded([...expanded])
  }, [expanded, load])

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function retry(channelId: string, path: string) {
    requested.current.delete(nodeKey(channelId, path))
    load(channelId, path)
  }

  const { channelSort = 'section', categories } = useShellData()
  const groups = groupChannelsForPane(channels, channelSort, categories)

  return (
    <nav aria-label="자료실 폴더">
      {!isGuest && <MyEditingSection />}
      {!isGuest && (
        <ul className="space-y-px">
          <li>
            <Link
              href="/files"
              aria-current={pathname === '/files' && !activeChannel ? 'page' : undefined}
              className={cn(ROW_CLASS, pathname === '/files' && !activeChannel && ROW_ACTIVE_CLASS)}
            >
              <LibraryIcon aria-hidden="true" className="size-4 shrink-0" />
              전체 파일
            </Link>
          </li>
        </ul>
      )}

      {groups.length === 0 && <EmptyState compact title="참여한 채널이 없습니다" />}
      {groups.map(group => (
        <section key={group.key} aria-label={group.label}>
          <SubTitle>{group.label}</SubTitle>
          <ul className="space-y-px">
            {group.items.map(ch => (
              <TreeNode
                key={ch.id}
                channelId={ch.id}
                path=""
                label={ch.name}
                depth={0}
                icon={ch.kind === 'private' ? LockIcon : HashIcon}
                expanded={expanded}
                loads={loads}
                toggle={toggle}
                retry={retry}
                activeChannel={activeChannel}
                activePath={activePath}
                showCounts={showCounts}
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

function TreeNode({
  channelId,
  path,
  label,
  count,
  depth,
  icon: Icon = FolderIcon,
  expanded,
  loads,
  toggle,
  retry,
  activeChannel,
  activePath,
  showCounts,
}: {
  channelId: string
  /** 채널 루트는 '' */
  path: string
  label: string
  count?: number
  depth: number
  icon?: typeof FolderIcon
  expanded: Set<string>
  loads: Record<string, Load>
  toggle: (key: string) => void
  retry: (channelId: string, path: string) => void
  activeChannel: string | null
  activePath: string
  /** 폴더 파일 수 표시(이전 버전 포함 보기에서는 숨김) */
  showCounts: boolean
}) {
  const key = nodeKey(channelId, path)
  const isOpen = expanded.has(key)
  const load = loads[key]
  const active = activeChannel === channelId && activePath === path
  const href = filesFolderHref(channelId, { path })
  const listId = `files-tree-${channelId}-${path.length}-${hash(path)}`

  return (
    <li>
      <div
        className={cn(TREE_ROW_CLASS, active && ROW_ACTIVE_CLASS)}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          onClick={() => toggle(key)}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={`${label} ${isOpen ? '접기' : '펼치기'}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-w-md outline-none pointer-coarse:size-11 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')}
          />
        </button>
        <Link href={href} aria-current={active ? 'page' : undefined} className={linkClass}>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          {showCounts && count !== undefined && (
            <span className="shrink-0 text-xs text-sidebar-foreground/70">
              <span className="sr-only">파일 </span>
              {count.toLocaleString('ko-KR')}
              <span className="sr-only">개</span>
            </span>
          )}
        </Link>
      </div>
      {isOpen && (
        <ul id={listId} aria-label={`${label} 하위 폴더`} className="space-y-px">
          {(!load || load.status === 'loading') && (
            <li
              role="status"
              className="py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 28 }}
            >
              불러오는 중…
            </li>
          )}
          {load?.status === 'error' && (
            <li
              className="flex items-center gap-2 py-1 text-xs text-destructive"
              style={{ paddingLeft: (depth + 1) * 12 + 28 }}
            >
              <span role="alert">폴더를 불러오지 못했습니다.</span>
              <button
                type="button"
                onClick={() => retry(channelId, path)}
                className="rounded px-1 text-foreground underline outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                다시 시도
              </button>
            </li>
          )}
          {load?.status === 'ok' && load.folders.length === 0 && (
            <li
              className="py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 28 }}
            >
              하위 폴더 없음
            </li>
          )}
          {load?.status === 'ok' &&
            load.folders.map(f => (
              <TreeNode
                key={f.path}
                channelId={channelId}
                path={f.path}
                label={f.name}
                count={f.fileCount}
                depth={depth + 1}
                expanded={expanded}
                loads={loads}
                toggle={toggle}
                retry={retry}
                activeChannel={activeChannel}
                activePath={activePath}
                showCounts={showCounts}
              />
            ))}
        </ul>
      )}
    </li>
  )
}

/** 목록 id 용 짧은 해시(경로의 한글·공백이 id 에 들어가지 않게) */
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
