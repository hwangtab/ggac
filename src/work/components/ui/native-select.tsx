import * as React from 'react'
import { cn } from '@work/lib/utils'

/**
 * 브라우저 기본 <select> 에 Input 과 같은 겉모습(h-9·테두리·포커스 링)을 입힌 부품(docs/13 §2).
 * 손으로 select 클래스를 복제하지 말고 이것을 쓴다. 표·사이드바 안 인라인 편집만 `size="sm"`(h-8).
 */
function NativeSelect({
  className,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & { size?: 'default' | 'sm' }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'w-full min-w-0 rounded-w-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring aria-[invalid=true]:ring-destructive/20 md:text-sm dark:bg-input/30',
        size === 'default' ? 'h-9' : 'h-8',
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
