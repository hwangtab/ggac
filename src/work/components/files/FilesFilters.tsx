import Link from '@work/lib/nav/link'
import { LayoutGridIcon, ListIcon, SearchIcon } from 'lucide-work'
import { Button, buttonVariants } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import { NativeSelect } from '@work/components/ui/native-select'
import { FILE_KIND_FILTER_LABEL } from '@work/lib/files/mime'
import type { FileFilterOptions } from '@work/lib/files/queries'
import { FILE_KIND_VALUES, type FilesSearch } from '@work/lib/files/schema'
import { cn } from '@work/lib/utils'
import AutoApplyFilters from '@work/components/search/AutoApplyFilters'
import FilterDisclosure from './FilterDisclosure'
import { toWorkHref } from '@work/lib/nav/paths'

/** 현재 필터(채널·폴더 경로 포함)를 유지한 채 view·page 만 바꾼 링크 */
export function filesHref(search: Partial<FilesSearch>): string {
  const p = new URLSearchParams()
  if (search.q) p.set('q', search.q)
  if (search.channel) p.set('channel', search.channel)
  if (search.path) p.set('path', search.path)
  if (search.uploader) p.set('uploader', search.uploader)
  if (search.kind) p.set('kind', search.kind)
  if (search.from) p.set('from', search.from)
  if (search.to) p.set('to', search.to)
  if (search.versions === 'all') p.set('versions', 'all')
  if (search.view && search.view !== 'list') p.set('view', search.view)
  if (search.page && search.page > 1) p.set('page', String(search.page))
  const qs = p.toString()
  return qs ? `/files?${qs}` : '/files'
}

/**
 * 자료실 필터. GET 폼이라 JS 없이도 동작하고 URL 로 공유된다(서버 컴포넌트).
 * select·날짜를 바꾸면 AutoApplyFilters 가 곧바로 반영한다(QA #13). 보기 전환(그리드/목록)은 링크.
 */
export default function FilesFilters({
  search,
  options,
}: {
  search: FilesSearch
  options: FileFilterOptions
}) {
  const viewLink = (view: 'grid' | 'list') =>
    cn(
      buttonVariants({ variant: search.view === view ? 'secondary' : 'ghost', size: 'icon' }),
      search.view === view && 'ring-1 ring-border'
    )

  // 검색어는 검색창에 늘 보이므로 접히는 필터(채널·올린 사람·형식·기간)만 센다
  const activeCount = [search.channel, search.uploader, search.kind, search.from, search.to].filter(
    Boolean
  ).length

  return (
    <form
      method="get"
      // ggac 이식: 맨 <form action> 은 링크 래퍼를 거치지 않아 업무툴 경로(/board-room/files)로 직접 바꾼다
      action={toWorkHref('/files')}
      role="search"
      aria-label="파일 검색"
      className="flex flex-col gap-2"
    >
      <AutoApplyFilters />
      <input type="hidden" name="view" value={search.view} />
      {search.versions === 'all' && <input type="hidden" name="versions" value="all" />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            name="q"
            defaultValue={search.q ?? ''}
            placeholder="파일명 검색"
            aria-label="파일명 검색"
            className="pl-8"
          />
        </div>
        <Button type="submit" size="lg">
          검색
        </Button>
        <div role="group" aria-label="보기 방식" className="flex gap-1">
          <Link
            href={filesHref({ ...search, view: 'list', page: 1 })}
            className={viewLink('list')}
            aria-label="목록으로 보기"
            aria-current={search.view === 'list' ? 'true' : undefined}
          >
            <ListIcon aria-hidden="true" />
          </Link>
          <Link
            href={filesHref({ ...search, view: 'grid', page: 1 })}
            className={viewLink('grid')}
            aria-label="그리드로 보기"
            aria-current={search.view === 'grid' ? 'true' : undefined}
          >
            <LayoutGridIcon aria-hidden="true" />
          </Link>
        </div>
      </div>

      <FilterDisclosure activeCount={activeCount}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            채널
            <NativeSelect name="channel" defaultValue={search.channel ?? ''}>
              <option value="">전체 채널</option>
              {options.channels.map(c => (
                <option key={c.id} value={c.id}>
                  # {c.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            올린 사람
            <NativeSelect name="uploader" defaultValue={search.uploader ?? ''}>
              <option value="">전체 멤버</option>
              {options.uploaders.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.display_name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            형식
            <NativeSelect name="kind" defaultValue={search.kind ?? ''}>
              <option value="">전체 형식</option>
              {FILE_KIND_VALUES.map(k => (
                <option key={k} value={k}>
                  {FILE_KIND_FILTER_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label
            htmlFor="files-from"
            className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
          >
            시작일
            <Input id="files-from" type="date" name="from" defaultValue={search.from ?? ''} />
          </label>
          <label
            htmlFor="files-to"
            className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
          >
            종료일
            <Input id="files-to" type="date" name="to" defaultValue={search.to ?? ''} />
          </label>
        </div>
      </FilterDisclosure>
    </form>
  )
}
