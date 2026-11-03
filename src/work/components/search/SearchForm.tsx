import { Field, FieldLabel } from '@work/components/ui/field'
import { SearchIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { NativeSelect } from '@work/components/ui/native-select'
import { Input } from '@work/components/ui/input'
import type { SearchParams } from '@work/lib/search/params'
import { toWorkHref } from '@work/lib/nav/paths'
import AutoApplyFilters from './AutoApplyFilters'

export type SearchFormChannel = { id: string; name: string; kind: 'public' | 'private' | 'dm' }
export type SearchFormPerson = { user_id: string; display_name: string }

/**
 * 검색 폼 — JS 없이 GET /search?q=… 로 제출한다(상태는 URL 쿼리스트링이 전부).
 * 채널·작성자·날짜를 바꾸면 AutoApplyFilters 가 곧바로 반영한다(QA #13).
 */
export default function SearchForm({
  params,
  channels,
  people,
}: {
  params: SearchParams
  channels: SearchFormChannel[]
  people: SearchFormPerson[]
}) {
  return (
    <form
      // ggac 이식: 맨 <form action> 은 링크 래퍼를 거치지 않아 업무툴 경로(/board-room/search)로 직접 바꾼다
      action={toWorkHref('/search')}
      method="get"
      role="search"
      aria-label="전체 검색"
      className="space-y-4"
    >
      <AutoApplyFilters />
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="search-q" className="sr-only">
            검색어
          </label>
          <Input
            id="search-q"
            name="q"
            type="search"
            defaultValue={params.q}
            placeholder="메시지·파일 이름·사람 검색"
            autoComplete="off"
            className="h-9"
          />
        </div>
        <Button type="submit" size="lg">
          <SearchIcon aria-hidden="true" />
          검색
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="search-channel">채널</FieldLabel>
          <NativeSelect id="search-channel" name="channel" defaultValue={params.channel ?? ''}>
            <option value="">전체</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>
                {c.kind === 'private' ? '비공개 · ' : '# '}
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="search-author">작성자</FieldLabel>
          <NativeSelect id="search-author" name="author" defaultValue={params.author ?? ''}>
            <option value="">전체</option>
            {people.map(p => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="search-from">시작일</FieldLabel>
          <Input
            id="search-from"
            name="from"
            type="date"
            defaultValue={params.from ?? ''}
            className="h-9"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="search-to">종료일</FieldLabel>
          <Input
            id="search-to"
            name="to"
            type="date"
            defaultValue={params.to ?? ''}
            className="h-9"
          />
        </Field>
      </div>
    </form>
  )
}
