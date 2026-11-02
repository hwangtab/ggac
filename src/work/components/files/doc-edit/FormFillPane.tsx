'use client'

import { Field, FieldGroup, FieldLabel, FieldHint, FieldChoice } from '@work/components/ui/field'
import { Input } from '@work/components/ui/input'
import { NoticeBanner } from '@work/components/layout/page'
import {
  FORM_LOW_CONFIDENCE,
  type FormFieldInfo,
  type FormSchemaInfo,
} from '@work/lib/files/doc-edit-types'
import { clickHereKey, fieldKey, formatAmount, type FillState } from './doc-edit-ui'

const INPUT_TYPE: Record<FormFieldInfo['kind'], string> = {
  text: 'text',
  date: 'date',
  phone: 'tel',
  email: 'email',
  amount: 'text',
  checkbox: 'checkbox',
  idnum: 'text',
}

function Original({ value }: { value: string }) {
  if (!value) return null
  return (
    <span className="text-xs text-muted-foreground" data-testid="field-original">
      원래 값: {value}
    </span>
  )
}

function FieldRow({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormFieldInfo
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const id = `fill-${field.label}`
  const label = (
    <>
      {field.label}
      {field.required && (
        <>
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            ※
          </span>
          <span className="sr-only"> (필수)</span>
        </>
      )}
    </>
  )

  if (field.kind === 'checkbox') {
    return (
      <FieldChoice>
        <input
          id={id}
          type="checkbox"
          checked={value === 'true'}
          disabled={disabled}
          onChange={e => onChange(e.target.checked ? 'true' : '')}
        />
        <span className="grid gap-0.5">
          <span>{label}</span>
          <Original value={field.value} />
        </span>
      </FieldChoice>
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {field.repeated && (
          <FieldHint className="text-xs">(여러 곳에 같은 값이 들어갑니다)</FieldHint>
        )}
      </FieldLabel>
      <Input
        id={id}
        type={INPUT_TYPE[field.kind]}
        inputMode={field.kind === 'amount' ? 'numeric' : undefined}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={e =>
          onChange(field.kind === 'amount' ? formatAmount(e.target.value) : e.target.value)
        }
        aria-describedby={field.kind === 'idnum' ? `${id}-hint` : undefined}
      />
      {field.kind === 'idnum' && (
        <span id={`${id}-hint`} className="text-xs font-medium text-foreground">
          주민등록번호는 문서에 그대로 들어갑니다. 꼭 필요한 경우에만 입력하세요.
        </span>
      )}
      <Original value={field.value} />
    </Field>
  )
}

/** 양식 채우기 입력 — 누름틀(문서 칸) 묶음을 위에, 표의 라벨→값 칸을 아래에 (docs/10 §2-2) */
export default function FormFillPane({
  schema,
  state,
  onChange,
  disabled = false,
}: {
  schema: FormSchemaInfo
  state: FillState
  onChange: (key: string, value: string) => void
  disabled?: boolean
}) {
  const empty = schema.fields.length === 0 && schema.clickHere.length === 0
  if (empty) {
    return (
      <p role="status" className="rounded-w-md border p-3 text-sm text-muted-foreground">
        채울 칸을 찾지 못했습니다 — 문구 고치기를 써 보세요.
      </p>
    )
  }
  return (
    <div className="grid gap-4">
      {schema.confidence < FORM_LOW_CONFIDENCE && (
        <NoticeBanner role="status">
          칸을 잘못 찾았을 수 있어요. 미리보기에서 꼭 확인해 주세요.
        </NoticeBanner>
      )}
      {schema.clickHere.length > 0 && (
        <fieldset className="grid gap-3 rounded-w-md border p-3">
          <legend className="px-1 text-sm font-medium">문서 칸</legend>
          {schema.clickHere.map(c => {
            const id = `fill-ch-${c.name}`
            return (
              <Field key={c.name}>
                <FieldLabel htmlFor={id}>{c.name}</FieldLabel>
                <Input
                  id={id}
                  autoComplete="off"
                  value={state[clickHereKey(c.name)] ?? ''}
                  disabled={disabled}
                  placeholder={c.placeholder ?? undefined}
                  onChange={e => onChange(clickHereKey(c.name), e.target.value)}
                />
                <Original value={c.value} />
              </Field>
            )
          })}
        </fieldset>
      )}
      <FieldGroup>
        {schema.fields.map(f => (
          <FieldRow
            key={f.label}
            field={f}
            value={state[fieldKey(f.label)] ?? ''}
            disabled={disabled}
            onChange={v => onChange(fieldKey(f.label), v)}
          />
        ))}
      </FieldGroup>
    </div>
  )
}
