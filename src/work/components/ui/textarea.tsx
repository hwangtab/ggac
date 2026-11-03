import * as React from 'react'
import { cn } from '@work/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex [field-sizing:content] min-h-16 w-full rounded-w-lg border border-input bg-background text-foreground px-2.5 py-2 text-base transition-colors outline-none placeholder:text-primary/40 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-disabled-foreground aria-[invalid=true]:border-destructive md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
