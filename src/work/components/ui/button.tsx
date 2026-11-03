import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@work/lib/utils'

/*
 * 버튼 — ggac 포스터 문법(docs/board-work/03-통합-재설계.md §4-5).
 * - 주(default): 흰 바탕·검은 글자·2px(`not-found.tsx` CTA, 이사회실 활성 메뉴와 같은 언어). hover 흰 85%
 * - 보조(outline·secondary): 투명 + 흰 30% 선, hover 흰 10% 면·흰 70% 선(`.tw-btn-secondary`)
 * - 위험(destructive): `#fca5a5` 글자 + 헤어라인, hover 옅은 빨강 면
 * - 고스트: 흰 72% 글자, hover 흰 12% 면
 * - 비활성: 모든 변형이 같은 포스터 비활성 모양(흰 14% 바탕·흰 45% 글자). `opacity`로 흐리게 하지 않는다 —
 *   흰 버튼이 회색이 되어 대비가 떨어진다
 * - 포커스: 전역 `:focus-visible` outline 하나(globals.css). 여기서 ring을 더하지 않는다
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-w-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors select-none [&:not([aria-haspopup])]:active:translate-y-px disabled:pointer-events-none disabled:border-transparent disabled:bg-disabled disabled:text-disabled-foreground aria-[invalid=true]:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        outline:
          'border-primary/30 bg-transparent text-foreground hover:border-primary/70 hover:bg-primary/10 aria-expanded:border-primary/70 aria-expanded:bg-primary/10',
        secondary:
          'border-primary/30 bg-transparent text-foreground hover:border-primary/70 hover:bg-primary/10 aria-expanded:border-primary/70 aria-expanded:bg-primary/10',
        ghost:
          'text-subtle-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground disabled:bg-transparent',
        destructive:
          'border-border bg-transparent text-destructive hover:border-destructive/40 hover:bg-destructive/10',
        link: 'text-foreground underline-offset-4 hover:underline disabled:bg-transparent',
      },
      size: {
        default:
          'h-8 pointer-coarse:h-11 gap-1.5 px-2.5 has-[[data-icon=inline-end]]:pr-2 has-[[data-icon=inline-start]]:pl-2',
        xs: "h-6 pointer-coarse:h-11 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [[data-slot=button-group]_&]:rounded-w-lg has-[[data-icon=inline-end]]:pr-1.5 has-[[data-icon=inline-start]]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 pointer-coarse:h-11 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [[data-slot=button-group]_&]:rounded-w-lg has-[[data-icon=inline-end]]:pr-1.5 has-[[data-icon=inline-start]]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 pointer-coarse:h-11 gap-1.5 px-2.5 has-[[data-icon=inline-end]]:pr-2 has-[[data-icon=inline-start]]:pl-2',
        icon: 'size-8 pointer-coarse:size-11',
        'icon-xs':
          "size-6 pointer-coarse:size-11 rounded-[min(var(--radius-md),10px)] [[data-slot=button-group]_&]:rounded-w-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 pointer-coarse:size-11 rounded-[min(var(--radius-md),12px)] [[data-slot=button-group]_&]:rounded-w-lg',
        'icon-lg': 'size-9 pointer-coarse:size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
