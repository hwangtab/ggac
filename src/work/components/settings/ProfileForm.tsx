'use client'

import { Field, FieldLabel, FieldDescription, FieldError } from '@work/components/ui/field'
import { useActionState } from 'react'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import type { ProfileFormState } from '@work/lib/auth/profile-schema'
// ggac 이식: 원본 app/(app)/settings/actions.ts → src/work/lib/settings/actions.ts
import { updateStaffProfile } from '@work/lib/settings/actions'

const INITIAL: ProfileFormState = { status: 'idle' }

/**
 * 표시 이름 + 업무툴 직함(03 §10). 직함 칸의 값은 **업무툴 직함**(`work_title`)이다 — 비워 두면 업무 화면에 이사회
 * 직함(`officialTitle`)이 보인다. 이사회 직함 자체는 관리자가 정하고 이 폼이 바꾸지 않는다.
 */
export default function ProfileForm({
  displayName,
  title,
  officialTitle,
}: {
  displayName: string
  /** 업무툴 직함(없으면 빈 칸) */
  title: string | null
  /** 이사회 직함 — 안내 문구에만 쓴다 */
  officialTitle: string | null
}) {
  const [state, action, pending] = useActionState(updateStaffProfile, INITIAL)
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field>
        <FieldLabel htmlFor="displayName">표시 이름</FieldLabel>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          maxLength={50}
          required
          className="h-9"
          aria-invalid={fieldErrors?.displayName ? true : undefined}
          aria-describedby={fieldErrors?.displayName ? 'displayName-error' : undefined}
        />
        {fieldErrors?.displayName && (
          <FieldError id="displayName-error">{fieldErrors.displayName}</FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="title">직함</FieldLabel>
        <Input
          id="title"
          name="title"
          defaultValue={title ?? ''}
          maxLength={50}
          placeholder={officialTitle ?? '예: 총무 담당'}
          className="h-9"
          aria-invalid={fieldErrors?.title ? true : undefined}
          aria-describedby={fieldErrors?.title ? 'title-hint title-error' : 'title-hint'}
        />
        <FieldDescription id="title-hint">
          업무 화면에만 보입니다. 비워 두면 이사회 직함({officialTitle ?? '없음'})이 보입니다.
        </FieldDescription>
        {fieldErrors?.title && <FieldError id="title-error">{fieldErrors.title}</FieldError>}
      </Field>
      <div className="flex items-center justify-between gap-3">
        <p
          role="status"
          className={
            state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {state.status === 'idle' ? '' : state.message}
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
      </div>
    </form>
  )
}
