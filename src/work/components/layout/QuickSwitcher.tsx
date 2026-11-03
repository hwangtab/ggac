'use client'

import { useState, useTransition } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { BookOpenIcon, HashIcon, LockIcon, SearchIcon, UserIcon, UserPlusIcon } from 'lucide-work'
import { openDm } from '@work/lib/channels/actions'
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@work/components/ui/command'
import { categoryLabelOf } from '@work/lib/channels/sections'
import { useShellData } from './shell-context'
import { channelHref, type ChannelListItem } from './channel-items'
import { EmptyState } from './page'

export type QuickSwitcherWikiDoc = { slug: string; title: string; category: string }

/** ⌘K "사람" 후보 — 활성 staff(서브관리자 포함, 나는 '이름 (나)' = 나와의 채팅). 고르면 DM 을 연다(이력이 없어도 만든다) */
export type QuickSwitcherPerson = { userId: string; name: string; title: string | null }

/** ggac 이식: 전체 검색(/search)을 켰는가 — 4단계에서 켰다. 끄면 ⌘Enter·빈 결과의 "전체 검색"도 숨는다 */
const SEARCH_ENABLED = true

/** 빠른 이동에 보이는 위키 후보 최대 수 */
export const WIKI_CANDIDATE_LIMIT = 8

/**
 * 위키 후보: 검색어의 낱말이 모두 제목·카테고리에 들어 있는 문서만, 최대 limit 개.
 * 수백 개 문서를 전부 CommandItem 으로 그리지 않도록 cmdk 필터 전에 먼저 거른다.
 * 제목에서 맞은 문서를 카테고리에서만 맞은 문서보다 앞에 둔다.
 */
export function filterWikiDocs(
  docs: readonly QuickSwitcherWikiDoc[],
  query: string,
  limit = WIKI_CANDIDATE_LIMIT
): QuickSwitcherWikiDoc[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const inTitle: QuickSwitcherWikiDoc[] = []
  const inCategory: QuickSwitcherWikiDoc[] = []
  for (const doc of docs) {
    const title = doc.title.toLowerCase()
    const hay = `${title} ${doc.category.toLowerCase()}`
    if (!terms.every(t => hay.includes(t))) continue
    ;(terms.every(t => title.includes(t)) ? inTitle : inCategory).push(doc)
    if (inTitle.length >= limit) break
  }
  return [...inTitle, ...inCategory].slice(0, limit)
}

/**
 * ⌘K 빠른 이동 — 사이드바와 같은 items 로 채널·DM 을 찾아 이동한다.
 * people 을 주면 "사람" 묶음에서 아무 직원이나 골라 DM 을 연다(openDm — 기존 DM 이력이 없어도, QA #17).
 * (메시지 전문검색은 /search 가 맡는다.)
 */
export default function QuickSwitcher({
  open,
  onOpenChange,
  items,
  wikiDocs = [],
  people = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ChannelListItem[]
  /** 조합 위키 문서(검색어를 입력했을 때만 후보로 보인다) */
  wikiDocs?: QuickSwitcherWikiDoc[]
  /** DM 을 열 수 있는 사람(활성 내부 staff, 나 제외) */
  people?: QuickSwitcherPerson[]
}) {
  const router = useRouter()
  const { categories = [] } = useShellData()
  const [query, setQuery] = useState('')
  const [dmError, setDmError] = useState<string | null>(null)
  const [opening, startOpen] = useTransition()
  const channels = items.filter(i => i.kind !== 'dm')
  const dms = items.filter(i => i.kind === 'dm')
  const wikiMatches = filterWikiDocs(wikiDocs, query)

  function close(next: boolean) {
    if (!next) {
      setQuery('')
      setDmError(null)
    }
    onOpenChange(next)
  }

  /** 사람 → DM 열기(없으면 서버가 만든다). 실패하면 창을 닫지 않고 안내한다 */
  function goPerson(person: QuickSwitcherPerson) {
    setDmError(null)
    startOpen(async () => {
      let res: Awaited<ReturnType<typeof openDm>>
      try {
        res = await openDm({ userId: person.userId })
      } catch (e) {
        console.error('[QuickSwitcher] openDm', e)
        res = { ok: false, error: '대화를 열지 못했습니다. 잠시 후 다시 시도해 주세요.' }
      }
      if (!res.ok) {
        setDmError(res.error)
        return
      }
      close(false)
      router.push(`/dm/${res.data.id}`)
    })
  }

  function go(item: ChannelListItem) {
    close(false)
    router.push(channelHref(item))
  }

  /** 입력한 말로 전체 검색(/search?q=)으로 이동 — 메시지·파일·사람. */
  function goSearch() {
    const q = query.trim()
    if (!q || !SEARCH_ENABLED) return
    close(false)
    router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  // 폰은 화면 위쪽에 붙여 화상 키보드가 올라와도 목록이 가려지지 않게 한다(데스크톱은 top-1/3)
  return (
    <CommandDialog open={open} onOpenChange={close} className="max-md:top-4">
      <Command
        onKeyDown={e => {
          // ⌘/Ctrl+Enter: 선택된 항목과 상관없이 전체 검색
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            goSearch()
          }
        }}
      >
        <CommandInput
          placeholder="채널·사람 이동, 또는 검색어 입력"
          aria-label="채널이나 사람 이름 검색"
          value={query}
          onValueChange={setQuery}
        />
        {dmError && (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {dmError}
          </p>
        )}
        <CommandList>
          <CommandEmpty>
            {SEARCH_ENABLED && query.trim() ? (
              <button
                type="button"
                onClick={goSearch}
                className="w-full px-3 text-muted-foreground outline-none hover:text-foreground"
              >
                결과가 없습니다 · Enter 로 전체 검색
              </button>
            ) : (
              <EmptyState compact title="찾는 채널이 없습니다." className="py-0" />
            )}
          </CommandEmpty>
          {channels.length > 0 && (
            <CommandGroup heading="채널">
              {channels.map(item => (
                <CommandItem
                  className="h-8 pointer-coarse:h-11"
                  key={item.id}
                  value={`${item.name} ${item.slug ?? ''} ${categoryLabelOf(item, categories) ?? ''}`}
                  onSelect={() => go(item)}
                >
                  {item.kind === 'private' ? (
                    <LockIcon aria-hidden="true" />
                  ) : (
                    <HashIcon aria-hidden="true" />
                  )}
                  {item.name}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {categoryLabelOf(item, categories)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {dms.length > 0 && (
            <CommandGroup heading="다이렉트 메시지">
              {dms.map(item => (
                <CommandItem
                  className="h-8 pointer-coarse:h-11"
                  key={item.id}
                  value={`dm ${item.name}`}
                  onSelect={() => go(item)}
                >
                  <UserIcon aria-hidden="true" />
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {people.length > 0 && (
            <CommandGroup heading="사람">
              {people.map(p => (
                <CommandItem
                  className="h-8 pointer-coarse:h-11"
                  key={p.userId}
                  value={`사람 ${p.name} ${p.title ?? ''} ${p.userId}`}
                  disabled={opening}
                  onSelect={() => goPerson(p)}
                >
                  <UserPlusIcon aria-hidden="true" />
                  {p.name}
                  {p.title && (
                    <span className="ml-auto text-xs text-muted-foreground">{p.title}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {wikiMatches.length > 0 && (
            <CommandGroup heading="조합 위키">
              {wikiMatches.map(doc => (
                <CommandItem
                  className="h-8 pointer-coarse:h-11"
                  key={doc.slug}
                  value={`위키 ${doc.title} ${doc.category}`}
                  onSelect={() => {
                    close(false)
                    router.push(`/wiki/${doc.slug}`)
                  }}
                >
                  <BookOpenIcon aria-hidden="true" />
                  {doc.title}
                  <span className="ml-auto text-xs text-muted-foreground">{doc.category}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {SEARCH_ENABLED && query.trim() && (
            <CommandGroup heading="전체 검색">
              <CommandItem
                className="h-8 pointer-coarse:h-11"
                forceMount
                value={`__search__ ${query}`}
                onSelect={goSearch}
              >
                <SearchIcon aria-hidden="true" />
                &lsquo;{query.trim()}&rsquo; 메시지·파일·문서 내용·사람 검색
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
