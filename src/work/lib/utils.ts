import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 원본(kosmart-work)은 tailwind-merge 3(Tailwind v4용)이다. ggac는 Tailwind 3.4라 tailwind-merge 2를 쓴다.
 * 업무툴 반경은 ggac 전역 `rounded-lg`와 섞이지 않게 `rounded-w-*`로 옮겼으므로(port-from-kosmart.mjs),
 * 그 값을 반경 그룹으로 알려 줘야 `cn('rounded-w-lg', 'rounded-w-xl')`이 뒤엣것 하나로 합쳐진다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: ['w-sm', 'w-md', 'w-lg', 'w-xl', 'w-2xl', 'w-3xl', 'w-4xl'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
