'use client'

import { useId, useMemo, useState } from 'react'
import RemovableChips from '@work/components/layout/chips'
import { UserIcon } from 'lucide-work'
import { Input } from '@work/components/ui/input'
import type { ShellPerson } from '@work/components/layout/shell-context'

const ROLE_LABEL: Record<NonNullable<ShellPerson['role']>, string> = {
  owner: '관리자',
  admin: '관리자',
  member: '',
  guest: '서브관리자',
}

/**
 * 사람 여러 명 고르기 — 검색 · 선택한 사람 칩 · 체크 목록. 채널 만들기 대화상자가 쓴다.
 * 선택 상태는 호출한 쪽이 가진다(controlled). 후보는 호출한 쪽이 이미 거른 값(활성 staff, 나 제외).
 */
export default function MemberPicker({
  people,
  selected,
  onChange,
  disabled = false,
  quickAdd,
  legend = '멤버 초대',
}: {
  people: ShellPerson[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** "관리자 모두 추가" 같은 빠른 버튼 — ids 를 선택에 더한다 */
  quickAdd?: { label: string; ids: string[] }
  legend?: string
}) {
  const [query, setQuery] = useState('')
  const uid = useId()
  const byId = useMemo(() => new Map(people.map(p => [p.userId, p])), [people])
  const selectedPeople = selected.flatMap(id => {
    const p = byId.get(id)
    return p ? [p] : []
  })

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people
      .filter(
        p => !q || p.name.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [people, query])

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  const quickIds = quickAdd?.ids ?? []
  const quickDone = quickIds.length > 0 && quickIds.every(id => selected.includes(id))

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {legend} <span className="font-normal text-muted-foreground">(선택)</span>
      </legend>

      {quickAdd && quickIds.length > 0 && (
        <button
          type="button"
          disabled={disabled || quickDone}
          onClick={() => onChange([...new Set([...selected, ...quickIds])])}
          className="inline-flex h-8 items-center rounded-w-md border px-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {quickDone ? `${quickAdd.label} (추가됨)` : quickAdd.label}
        </button>
      )}

      <RemovableChips
        ariaLabel="초대할 사람"
        items={selectedPeople.map(p => ({ id: p.userId, label: p.name }))}
        onRemove={toggle}
        disabled={disabled}
      />
      <p role="status" className="text-xs text-muted-foreground">
        {selected.length === 0 ? '' : `${selected.length}명 선택됨`}
      </p>

      <label htmlFor={`${uid}-q`} className="sr-only">
        이름이나 직함으로 사람 찾기
      </label>
      <Input
        id={`${uid}-q`}
        type="search"
        value={query}
        placeholder="이름이나 직함으로 찾기"
        onChange={e => setQuery(e.target.value)}
      />

      <ul aria-label="초대 후보" className="max-h-48 divide-y overflow-y-auto rounded-w-lg border">
        {shown.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">찾는 사람이 없습니다.</li>
        )}
        {shown.map(p => {
          const optId = `${uid}-opt-${p.userId}`
          const roleLabel = p.role ? ROLE_LABEL[p.role] : ''
          return (
            <li key={p.userId}>
              <label
                htmlFor={optId}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted has-[:focus-visible]:bg-muted"
              >
                <input
                  id={optId}
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={selected.includes(p.userId)}
                  disabled={disabled}
                  onChange={() => toggle(p.userId)}
                />
                <UserIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="max-w-full shrink-0 truncate font-medium">{p.name}</span>
                {p.title && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{p.title}</span>
                )}
                {roleLabel && (
                  <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                    {roleLabel}
                  </span>
                )}
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
