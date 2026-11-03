import * as React from 'react'
import { cn } from '@work/lib/utils'

/**
 * 폼 필드 부품(docs/13 §9 p) — 라벨 위·입력칸 아래로 쌓는 필드는 전부 이것으로 만든다.
 *
 * - `FieldGroup`: 필드 사이 `gap-4`(폼 본문).
 * - `Field`: 라벨 → 입력 → 설명/오류를 `flex-col gap-2`(8px)로 쌓는다. `size="sm"`(패널·필터 줄)은 `gap-1.5` + 작은 라벨.
 * - `FieldLabel`: `<label>`. 자체가 flex 라 부모가 무엇이든 간격이 산다.
 *
 * 왜 따로 두나: Tailwind v4 의 `space-y-*` 는 앞 형제에 margin-bottom 을 주는데, 클래스 없는 `<label>` 은 inline 이라
 * 세로 margin 이 무시돼 라벨과 입력칸이 붙는다. 화면마다 `space-y-1`·`gap-1`·`gap-1.5` 가 섞여 있던 것도 여기로 모은다.
 */
function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('flex flex-col gap-4', className)} {...props} />
}

function Field({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="field"
      data-size={size}
      className={cn('group/field flex min-w-0 flex-col gap-2 data-[size=sm]:gap-1.5', className)}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- htmlFor 는 쓰는 쪽이 넘긴다
    <label
      data-slot="field-label"
      className={cn(
        'flex items-center gap-1 text-sm leading-5 font-medium group-data-[size=sm]/field:text-xs group-data-[size=sm]/field:leading-4 group-data-[size=sm]/field:text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

/** 라벨 옆 "(선택)" 같은 보조 표기 */
function FieldHint({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="field-hint"
      className={cn('font-normal text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn('text-xs text-destructive', className)}
      {...props}
    />
  )
}

/**
 * 라디오·체크박스 묶음. fieldset 의 legend 는 flex 배치에서 빠지므로 legend 아래 간격은 `FieldLegend` 의 `mb-2` 가 맡고,
 * 선택지 사이는 `gap-2`.
 */
function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn('m-0 flex min-w-0 flex-col gap-2 border-0 p-0', className)}
      {...props}
    />
  )
}

function FieldLegend({ className, ...props }: React.ComponentProps<'legend'>) {
  return (
    <legend
      data-slot="field-legend"
      className={cn('mb-2 p-0 text-sm leading-5 font-medium', className)}
      {...props}
    />
  )
}

/** 라디오·체크박스 한 줄: 컨트롤 + 글. 컨트롤은 첫 줄 가운데에 맞춘다. */
function FieldChoice({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- 컨트롤을 자식으로 감싼다
    <label
      data-slot="field-choice"
      className={cn(
        'flex items-start gap-2 text-sm leading-5 [&>input]:mt-0.5 [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-primary',
        className
      )}
      {...props}
    />
  )
}

export {
  FieldGroup,
  Field,
  FieldLabel,
  FieldHint,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
  FieldChoice,
}
