'use client'

import { Field, FieldLabel } from '@work/components/ui/field'
import RemovableChips from '@work/components/layout/chips'
import { SectionHeading } from '@work/components/layout/page'
import { useId, useMemo, useState, useTransition } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { UserIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import { openDm } from '@work/lib/channels/actions'
import { createGroupChat } from '@work/lib/channels/group-actions'
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX } from '@work/lib/channels/group'
import type { StaffSummary } from '@work/lib/channels/types'
import { cn } from '@work/lib/utils'

/** 나(본인)를 뺀 최대 선택 수 */
const MAX_OTHERS = GROUP_MAX_MEMBERS - 1

/**
 * 새 채팅 상대 고르기 — `/chat?new=1` 과 채널 찾아보기(`/c`)가 함께 쓴다.
 * 1명 → 서버 액션 openDm 으로 1:1 DM(`/dm/<id>`), 2명 이상 → createGroupChat 으로 그룹(`/dm/<id>`).
 * 클라이언트는 DM·그룹을 못 만든다(서버 경유). 서브관리자도 그룹에 넣을 수 있다 — 서브관리자 본인에게는
 * 상위(`/chat` 페이지)가 자기 채널의 공동 멤버만 people 로 내려 준다(서버도 같은 규칙으로 다시 검사).
 * 나 자신은 목록 맨 위에 '이름 (나)'로 둔다 — 나만 고르면 나와의 채팅(openDm 에 내 id), 다른 사람과 함께 고르면
 * 나는 원래 포함되므로 무시한다.
 */
export default function NewChatPicker({
  people,
  meId,
}: {
  /** 상대 후보(활성 staff — 나 자신은 맨 위 '이름 (나)' = 나와의 채팅) */
  people: StaffSummary[]
  meId: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const uid = useId()
  const searchId = `${uid}-search`
  const nameId = `${uid}-name`
  const nameHintId = `${uid}-name-hint`
  const limitId = `${uid}-limit`

  const candidates = useMemo(() => {
    const active = people.filter(p => p.status === 'active')
    const me = active.find(p => p.user_id === meId)
    const others = active.filter(p => p.user_id !== meId)
    return me ? [{ ...me, display_name: `${me.display_name} (나)` }, ...others] : others
  }, [people, meId])
  const byId = useMemo(() => new Map(candidates.map(p => [p.user_id, p])), [candidates])
  const selectedPeople = selected.flatMap(id => {
    const p = byId.get(id)
    return p ? [p] : []
  })
  // 나는 늘 포함되므로 인원·그룹 판정은 나를 뺀 수로 한다
  const others = selected.filter(id => id !== meId)
  const atLimit = others.length >= MAX_OTHERS
  const isGroup = others.length >= 2

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates
      .filter(
        p =>
          !q ||
          p.display_name.toLowerCase().includes(q) ||
          (p.title ?? '').toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [candidates, query])

  const trimmedName = name.trim()
  const nameTooLong = trimmedName.length > GROUP_TITLE_MAX

  /** 이 사람을 지금 체크할 수 없는 이유(없으면 null) */
  function blockedReason(p: StaffSummary): string | null {
    if (selected.includes(p.user_id) || p.user_id === meId) return null
    if (atLimit) return `본인 포함 ${GROUP_MAX_MEMBERS}명까지 고를 수 있습니다`
    return null
  }

  function toggle(userId: string) {
    setError(null)
    setNotice(null)
    setSelected(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  function go(id: string) {
    router.push(`/dm/${id}`)
  }

  function submit(forceNew: boolean) {
    setError(null)
    setNotice(null)
    if (selected.length === 0) {
      setError('대화할 사람을 한 명 이상 골라 주세요.')
      return
    }
    if (nameTooLong && isGroup) {
      setError(`그룹 이름은 ${GROUP_TITLE_MAX}자까지 쓸 수 있습니다.`)
      return
    }
    start(async () => {
      if (!isGroup) {
        // 나만 골랐으면 나와의 채팅, 아니면 고른 상대 한 명
        const res = await openDm({ userId: others[0] ?? meId })
        if (!res.ok) {
          setError(res.error)
          return
        }
        go(res.data.id)
        return
      }
      const res = await createGroupChat({
        userIds: others,
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(forceNew ? { forceNew: true } : {}),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.data.existing) {
        setNotice('같은 사람들과의 기존 대화를 열었습니다.')
      }
      go(res.data.id)
    })
  }

  // 사이드바 '+ 새 채팅'(/chat?new=1)과 옛 링크(/c#dm)가 여기로 온다
  return (
    <section id="dm" aria-labelledby={`${uid}-h`} className="scroll-mt-4 space-y-3">
      <SectionHeading id={`${uid}-h`}>새 채팅</SectionHeading>
      <p className="text-xs text-muted-foreground">
        한 명을 고르면 1:1 대화, 두 명 이상 고르면 그룹 채팅입니다.
      </p>

      <RemovableChips
        ariaLabel="선택한 사람"
        items={selectedPeople.map(p => ({ id: p.user_id, label: p.display_name }))}
        onRemove={toggle}
      />
      {/* 아무도 안 골랐을 땐 sr-only(문서 흐름에서 빠진다) — 빈 상태 요소가 space-y 간격 16px 을 차지해 덜컥 밀리던 것 */}
      <p
        role="status"
        className={cn('text-xs text-muted-foreground', selected.length === 0 && 'sr-only')}
      >
        {selected.length === 0 ? '' : `${selected.length}명 선택됨`}
        {atLimit ? ` — 본인 포함 최대 ${GROUP_MAX_MEMBERS}명까지 고를 수 있습니다.` : ''}
      </p>

      <label htmlFor={searchId} className="sr-only">
        이름이나 직함으로 사람 찾기
      </label>
      <Input
        id={searchId}
        type="search"
        value={query}
        placeholder="이름이나 직함으로 찾기"
        onChange={e => setQuery(e.target.value)}
      />

      <ul aria-label="대화 상대" className="divide-y rounded-w-lg border">
        {shown.map(p => {
          const checked = selected.includes(p.user_id)
          const reason = blockedReason(p)
          const optId = `${uid}-opt-${p.user_id}`
          return (
            <li key={p.user_id}>
              <label
                htmlFor={optId}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:bg-muted"
              >
                <input
                  id={optId}
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={checked}
                  disabled={pending || reason !== null}
                  aria-describedby={reason ? `${optId}-why` : undefined}
                  onChange={() => toggle(p.user_id)}
                />
                <UserIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="max-w-full shrink-0 truncate font-medium">{p.display_name}</span>
                {p.title && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{p.title}</span>
                )}
                {p.role === 'guest' && (
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                    서브관리자
                  </span>
                )}
              </label>
              {reason && (
                <span id={`${optId}-why`} className="sr-only">
                  {reason}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {isGroup && (
        <Field size="sm">
          <FieldLabel htmlFor={nameId}>그룹 이름(선택)</FieldLabel>
          <Input
            id={nameId}
            value={name}
            placeholder="비워 두면 참여자 이름으로 표시됩니다"
            aria-invalid={nameTooLong || undefined}
            aria-describedby={nameHintId}
            onChange={e => {
              setName(e.target.value)
              setError(null)
            }}
          />
          <p id={nameHintId} className="text-xs text-muted-foreground">
            {trimmedName.length}/{GROUP_TITLE_MAX}자
            {nameTooLong ? ` — ${GROUP_TITLE_MAX}자를 넘을 수 없습니다.` : ''}
          </p>
        </Field>
      )}
      <span id={limitId} className="sr-only">
        본인 포함 최대 {GROUP_MAX_MEMBERS}명
      </span>

      <div aria-live="polite" className="space-y-1">
        {notice && <p className="text-sm">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || selected.length === 0 || (isGroup && nameTooLong)}
          aria-describedby={limitId}
          onClick={() => submit(false)}
        >
          {isGroup ? (trimmedName ? '그룹 만들기' : '대화 시작') : '대화 시작'}
        </Button>
        {isGroup && !trimmedName && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit(true)}>
            새 그룹으로 만들기
          </Button>
        )}
      </div>
      {isGroup && !trimmedName && (
        <p className="text-xs text-muted-foreground">
          같은 사람들과의 이름 없는 대화가 이미 있으면 그 대화를 엽니다. 따로 새 대화가 필요하면
          &quot;새 그룹으로 만들기&quot;를 누르세요.
        </p>
      )}
    </section>
  )
}
