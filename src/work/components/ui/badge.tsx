import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@work/lib/utils'

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-w-lg border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all has-[[data-icon=inline-end]]:pr-1.5 has-[[data-icon=inline-start]]:pl-1.5 aria-[invalid=true]:border-destructive [&>svg]:pointer-events-none [&>svg]:!size-3',
  {
    variants: {
      // 칩 = 2px 사각·흰 7% 바탕·상태색 글자(이사회실 StatusBadge 계열, 03-통합-재설계 §4-5). 꽉 찬 색 면은 두지 않는다
      variant: {
        default: 'bg-subtle text-foreground hover:[&:is(a)]:bg-accent',
        secondary: 'bg-subtle text-subtle-foreground hover:[&:is(a)]:bg-accent',
        destructive: 'bg-subtle text-destructive hover:[&:is(a)]:bg-accent',
        success: 'bg-subtle text-online',
        outline: 'border-border text-subtle-foreground hover:[&:is(a)]:bg-accent',
        ghost: 'text-subtle-foreground hover:bg-accent hover:text-foreground',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  })
}

export { Badge, badgeVariants }
