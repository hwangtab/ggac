'use client'

import { Field, FieldLabel, FieldHint, FieldError } from '@work/components/ui/field'
import { useActionState } from 'react'
import { Button } from '@work/components/ui/button'
import { Input } from '@work/components/ui/input'
import type { ProfileFormState } from '@work/lib/auth/profile-schema'
// ggac 이식: 원본 app/(app)/settings/actions.ts → src/work/lib/settings/actions.ts
import { updateStaffProfile } from '@work/lib/settings/actions'

const INITIAL: ProfileFormState = { status: 'idle' }

export default function ProfileForm({
  displayName,
  title,
}: {
  displayName: string
  title: string | null
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
        <FieldLabel htmlFor="title">
          직함 <FieldHint>(관리자가 정합니다)</FieldHint>
        </FieldLabel>
        <Input
          id="title"
          name="title"
          defaultValue={title ?? ''}
          maxLength={50}
          placeholder="예: 이사"
          // ggac 이식: 직함은 관리자가 정한다(이사회 직함 director_title) — 읽기 전용으로 보여 주고 값은 그대로 보낸다
          readOnly
          className="h-9"
          aria-invalid={fieldErrors?.title ? true : undefined}
          aria-describedby={fieldErrors?.title ? 'title-error' : undefined}
        />
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
