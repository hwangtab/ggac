'use client'

import * as React from 'react'
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@work/lib/utils'

/*
 * 아바타 — 원형은 포스터의 예외다(03-통합-재설계 §4-5). 업무 화면은 `data-poster` 안이라 `rounded-full`이
 * 포스터 규칙(`.rounded-full → 2px`)에 사각이 되므로 `rounded-[50%]`로 쓴다. 머리글자 면은 흰 12%·글자 흰 72%
 * (바탕 #16161b와 같은 `bg-muted`로 두면 아바타가 사라진다).
 */
function Avatar({
  className,
  size = 'default',
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: 'default' | 'sm' | 'lg'
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-8 shrink-0 rounded-[50%] select-none after:absolute after:inset-0 after:rounded-[50%] after:border after:border-border data-[size=lg]:size-10 data-[size=sm]:size-6',
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full rounded-[50%] object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-[50%] bg-accent text-sm text-subtle-foreground group-data-[size=sm]/avatar:text-xs',
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-[50%] bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none',
        'group-data-[size=sm]/avatar:size-2 [&>svg]:group-data-[size=sm]/avatar:hidden',
        'group-data-[size=default]/avatar:size-2.5 [&>svg]:group-data-[size=default]/avatar:size-2',
        'group-data-[size=lg]/avatar:size-3 [&>svg]:group-data-[size=lg]/avatar:size-2',
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-2 data-[slot=avatar]:*:ring-2 data-[slot=avatar]:*:ring-background',
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-[50%] bg-accent text-sm text-subtle-foreground ring-2 ring-background group-has-[[data-size=lg]]/avatar-group:size-10 group-has-[[data-size=sm]]/avatar-group:size-6 [&>svg]:size-4 [&>svg]:group-has-[[data-size=lg]]/avatar-group:size-5 [&>svg]:group-has-[[data-size=sm]]/avatar-group:size-3',
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge }
