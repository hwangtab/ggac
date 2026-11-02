'use client'

import {
  Field,
  FieldLabel,
  FieldHint,
  FieldDescription,
  FieldSet,
  FieldLegend,
  FieldChoice,
} from '@work/components/ui/field'
import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from '@work/lib/nav/navigation'
import { Button } from '@work/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@work/components/ui/dialog'
import { Input } from '@work/components/ui/input'
import { NativeSelect } from '@work/components/ui/native-select'
import { createChannel } from '@work/lib/channels/actions'
import { toChannelSlug } from '@work/lib/channels/schema'
import { CATEGORY_NAME_MAX } from '@work/lib/channels/sections'
import { useShellData } from '@work/components/layout/shell-context'
import MemberPicker from './MemberPicker'

const NEW_CATEGORY = '__new__'

/**
 * 채널 만들기 대화상자(docs/15 §1-3) — 이름 · 카테고리 · 공개 범위 · 주제 · 멤버 초대.
 * 진입점: 사이드바 채널 패널 머리글 `+` 메뉴, `/c` 의 "새 채널", 빈 검색 결과의 "'X' 채널 만들기".
 * 카테고리·멤버 후보·"새 카테고리"는 셸 데이터(useShellData)에서 받는다 — 새 카테고리는 관리자(categoryOps)에게만.
 * 만들기 성공 → 닫고 새 채널로 이동. 멤버 추가가 일부 실패하면 채널은 만들어졌음을 알리고 채널 설정에서 다시 하라고 안내한다.
 */
export default function CreateChannelDialog({
  open,
  onOpenChange,
  initialName = '',
  defaultCategoryId = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 이름 미리 채움(빈 검색 결과에서 연 경우) */
  initialName?: string
  /** 지금 보고 있던 카테고리 — 없으면 기타 */
  defaultCategoryId?: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 채널 만들기</DialogTitle>
          <DialogDescription>
            채널은 주제별 대화방입니다. 1:1·그룹 대화는 채팅에서 시작하세요.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateChannelForm
            initialName={initialName}
            defaultCategoryId={defaultCategoryId}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateChannelForm({
  initialName,
  defaultCategoryId,
  onClose,
}: {
  initialName: string
  defaultCategoryId: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const { categories = [], categoryOps, people = [] } = useShellData()
  const [name, setName] = useState(initialName)
  const [topic, setTopic] = useState('')
  const [kind, setKind] = useState<'public' | 'private'>('public')
  const [category, setCategory] = useState<string>(
    defaultCategoryId && categories.some(c => c.id === defaultCategoryId) ? defaultCategoryId : ''
  )
  const [newCategory, setNewCategory] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{
    slug: string
    memberError: string
    addedCount: number
  } | null>(null)
  const [pending, start] = useTransition()
  // 새 카테고리를 만든 뒤 채널 만들기가 실패해 다시 누를 때 같은 카테고리를 또 만들지 않는다
  const createdCategory = useRef<{ name: string; id: string } | null>(null)
  const uid = useId()
  const nameId = `${uid}-name`
  const categoryId = `${uid}-category`
  const newCategoryId = `${uid}-new-category`
  const topicId = `${uid}-topic`
  const errorId = `${uid}-error`

  const adminIds = people.filter(p => p.role === 'owner' || p.role === 'admin').map(p => p.userId)
  const creatingCategory = category === NEW_CATEGORY

  function goTo(slug: string) {
    onClose()
    router.push(`/c/${encodeURIComponent(slug)}`)
    router.refresh()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      let categoryValue: string | null = category || null
      if (creatingCategory) {
        const wanted = newCategory.trim()
        if (!wanted) {
          setError('새 카테고리 이름을 입력해 주세요.')
          return
        }
        if (createdCategory.current?.name === wanted) {
          categoryValue = createdCategory.current.id
        } else if (categoryOps) {
          const made = await categoryOps.createCategory(wanted)
          if (!made.ok) {
            setError(made.error)
            return
          }
          createdCategory.current = { name: wanted, id: made.id }
          categoryValue = made.id
        } else {
          setError('카테고리를 만들 권한이 없습니다.')
          return
        }
      }
      const res = await createChannel({
        name,
        kind,
        topic,
        ...(categoryValue ? { categoryId: categoryValue } : {}),
        ...(memberIds.length > 0 ? { memberIds } : {}),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.data.memberError) {
        setDone({
          slug: res.data.slug,
          memberError: res.data.memberError,
          addedCount: res.data.addedCount,
        })
        router.refresh()
        return
      }
      goTo(res.data.slug)
    })
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm">
          채널은 만들어졌습니다. 다만 멤버 {memberIds.length - done.addedCount}명을 추가하지
          못했습니다 ({done.memberError}) 채널 설정에서 다시 추가해 주세요.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => goTo(done.slug)}>
            채널로 이동
          </Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-describedby={error ? errorId : undefined}
    >
      <Field>
        <FieldLabel htmlFor={nameId}>채널 이름</FieldLabel>
        <Input
          id={nameId}
          value={name}
          maxLength={80}
          required
          autoFocus
          placeholder="예: 씨앗페"
          onChange={e => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        {name.trim() && <FieldDescription>주소: /c/{toChannelSlug(name)}</FieldDescription>}
      </Field>

      <Field>
        <FieldLabel htmlFor={categoryId}>
          카테고리 <FieldHint>(선택)</FieldHint>
        </FieldLabel>
        <NativeSelect id={categoryId} value={category} onChange={e => setCategory(e.target.value)}>
          {categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {/* 사이드바처럼 기타(분류 없음)는 맨 끝 */}
          <option value="">기타</option>
          {categoryOps && <option value={NEW_CATEGORY}>새 카테고리…</option>}
        </NativeSelect>
        {creatingCategory && (
          <>
            <label htmlFor={newCategoryId} className="sr-only">
              새 카테고리 이름
            </label>
            <Input
              id={newCategoryId}
              value={newCategory}
              maxLength={CATEGORY_NAME_MAX}
              placeholder="새 카테고리 이름"
              onChange={e => setNewCategory(e.target.value)}
            />
          </>
        )}
      </Field>

      <FieldSet>
        <FieldLegend>공개 범위</FieldLegend>
        <FieldChoice>
          <input
            type="radio"
            name={`${uid}-kind`}
            value="public"
            checked={kind === 'public'}
            onChange={() => setKind('public')}
          />
          <span>공개 — 내부 직원 누구나 찾아 들어올 수 있습니다.</span>
        </FieldChoice>
        <FieldChoice>
          <input
            type="radio"
            name={`${uid}-kind`}
            value="private"
            checked={kind === 'private'}
            onChange={() => setKind('private')}
          />
          <span>비공개 — 초대한 사람과 업무툴 관리자가 볼 수 있습니다.</span>
        </FieldChoice>
      </FieldSet>

      <Field>
        <FieldLabel htmlFor={topicId}>
          주제 <FieldHint>(선택)</FieldHint>
        </FieldLabel>
        <Input
          id={topicId}
          value={topic}
          maxLength={250}
          onChange={e => setTopic(e.target.value)}
        />
      </Field>

      {people.length > 0 && (
        <MemberPicker
          people={people}
          selected={memberIds}
          onChange={setMemberIds}
          disabled={pending}
          quickAdd={{ label: '관리자 모두 추가', ids: adminIds }}
        />
      )}

      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* 멤버 목록이 길어 대화상자가 스크롤돼도 버튼은 늘 보이게 바닥에 붙인다(바탕은 muted/50 을 불투명하게) */}
      <DialogFooter className="sticky -bottom-6 z-10 bg-[color-mix(in_oklch,var(--muted)_50%,var(--background))]">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? '만드는 중…' : '만들기'}
        </Button>
      </DialogFooter>
    </form>
  )
}
