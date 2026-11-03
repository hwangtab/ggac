'use client'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@work/lib/utils'

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'z-50 inline-flex w-fit max-w-xs origin-[var(--transform-origin)] items-center gap-1.5 rounded-w-md bg-foreground px-3 py-1.5 text-xs text-background has-[[data-slot=kbd]]:pr-1.5 data-[side=bottom]:wa-slide-in-from-top-2 data-[side=inline-end]:wa-slide-in-from-left-2 data-[side=inline-start]:wa-slide-in-from-right-2 data-[side=left]:wa-slide-in-from-right-2 data-[side=right]:wa-slide-in-from-left-2 data-[side=top]:wa-slide-in-from-bottom-2 data-[slot=kbd]:[&_*]:relative data-[slot=kbd]:[&_*]:isolate data-[slot=kbd]:[&_*]:z-50 data-[slot=kbd]:[&_*]:rounded-w-sm data-[state=delayed-open]:wa-in data-[state=delayed-open]:wa-fade-in-0 data-[state=delayed-open]:wa-zoom-in-95 data-open:wa-in data-open:wa-fade-in-0 data-open:wa-zoom-in-95 data-closed:wa-out data-closed:wa-fade-out-0 data-closed:wa-zoom-out-95',
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:!top-1/2 data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:!top-1/2 data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:!top-1/2 data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:!top-1/2 data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
