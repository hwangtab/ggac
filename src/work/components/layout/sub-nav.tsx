import type { ComponentProps, ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import { cn } from '@work/lib/utils'

/**
 * 탭 줄(서브내비) 공용 부품 — docs/13 §9c.
 * 줄 `min-h-10 pointer-coarse:min-h-11` + `border-b`, 항목 `px-3 gap-1`, 활성 `border-b-2 border-primary` + `font-medium`(색 + 굵기),
 * 포커스는 ggac 전역 outline(globals.css — 업무 화면 안에서는 안쪽으로 그려 가로 스크롤 영역에서 잘리지 않는다). 활성 밑줄은 줄 테두리를 1px 덮는다(`-mb-px`).
 *
 * 링크만 있는 단순한 줄은 `SubNav` + `SubNavLink`. 오른쪽 안내·＋·⋯·드래그처럼 기능이 많은 줄(대화 탭 바, 관리 메뉴)은
 * 아래 클래스 상수만 가져다 쓴다 — 활성 표시를 손으로 조립하지 않는다(design-rules 검사).
 */

/** 줄(바깥): 높이·아래 테두리. 좌우 패딩·정렬은 호출처가 더한다 */
export const SUB_NAV_BAR_CLASS =
  'flex min-h-10 pointer-coarse:min-h-11 shrink-0 items-stretch gap-1 border-b'

/**
 * 항목을 품는 목록. 밑줄이 줄 테두리를 덮는 `-mb-px` 는 항목이 아니라 **이 목록**이 맡는다 —
 * 항목에 주면 가로 스크롤 영역(overflow-x)에서 1px 넘침이 세로 스크롤바를 만든다. 스크롤바는 감춘다.
 */
export const SUB_NAV_LIST_CLASS =
  '-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

/** 항목 공통(활성·비활성 공통 뼈대) */
export const SUB_NAV_ITEM_CLASS =
  'flex items-center gap-1 whitespace-nowrap border-b-2 px-3 text-sm outline-none'
/** 활성 = 밑줄 색 + 굵기(색 외의 단서, §9n) */
export const SUB_NAV_ACTIVE_CLASS = 'border-primary font-medium text-foreground'
export const SUB_NAV_IDLE_CLASS =
  'border-transparent text-muted-foreground transition-colors hover:text-foreground'

/** 항목 클래스 — `active` 에 맞는 상태를 붙인다 */
export function subNavItemClass(active: boolean, className?: string): string {
  return cn(SUB_NAV_ITEM_CLASS, active ? SUB_NAV_ACTIVE_CLASS : SUB_NAV_IDLE_CLASS, className)
}

/** 링크형 탭 줄. `label` 은 nav 의 접근성 이름("활동 보기" 등) */
export function SubNav({
  label,
  children,
  className,
  listClassName,
}: {
  label: string
  children: ReactNode
  /** 줄 바깥(좌우 패딩 `px-4 md:px-6` 등) */
  className?: string
  listClassName?: string
}) {
  return (
    <nav aria-label={label} className={cn(SUB_NAV_BAR_CLASS, className)}>
      <div className={cn(SUB_NAV_LIST_CLASS, listClassName)}>{children}</div>
    </nav>
  )
}

/** `SubNav` 안의 링크 항목 — `aria-current="page"` 는 `active` 가 맡는다 */
export function SubNavLink({
  active,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'aria-current'> & { active: boolean }) {
  return (
    <Link
      {...props}
      aria-current={active ? 'page' : undefined}
      className={subNavItemClass(active, className)}
    >
      {children}
    </Link>
  )
}
