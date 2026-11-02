import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@work/lib/utils'

/**
 * 표 공용 부품 — docs/13 §9d. 서버·클라이언트 컴포넌트 어디서나 쓴다(컨텍스트 없이 props 만).
 *
 * 두 형식:
 * - `card`(기본): 페이지 본문(PageBody) 안의 표. `overflow-hidden rounded-lg border` 카드 안.
 * - `full`: 화면 전체가 "필터 줄 + 표"인 작업 화면(결재 목록). 좌우 테두리 없이 전체 폭, 마지막 행까지 `border-b`.
 * 스크롤: 기본은 가로로만 넘친다(`overflow-x-auto`). 머리 행을 `THead sticky` 로 붙이는 표는 `scroll` 을 켠다 — 래퍼가
 * 가로·세로 스크롤 상자(`overflow-auto`)가 되어 sticky 가 이 상자 기준으로 붙는다. `overflow-x-auto` 만 있으면 그 래퍼가
 * sticky 의 스크롤 조상이 되는데 세로로는 스크롤하지 않아 머리 행이 영영 안 붙는다(2026-10-29 결재 목록 실측 top -498px).
 * `scroll` 이면 래퍼 높이가 정해져야 하므로 부모를 `flex flex-col` + 래퍼 `min-h-0 flex-1`(자동 적용)로 둔다.
 * 두 형식 모두 머리 행 `bg-muted/50 text-xs font-medium text-muted-foreground`, 행 `px-4 py-3`(밀집 `dense` = `py-2`),
 * `divide-y`, 셀 `align-middle`. 숫자·금액 칸은 `numeric`(`text-right tabular-nums`), 날짜 칸은 `nowrap` + `tabular-nums`.
 */

export type DataTableVariant = 'card' | 'full'

export function DataTable({
  variant = 'card',
  caption,
  tableClassName,
  className,
  scroll = false,
  children,
}: {
  variant?: DataTableVariant
  /** 스크린리더용 표 이름(화면에는 안 보인다) */
  caption: ReactNode
  /** 표 최소 폭 등 — 예: `min-w-[40rem]` (좁은 화면에서 가로 스크롤) */
  tableClassName?: string
  /** 바깥 래퍼(컨테이너 쿼리 `@container` 등) */
  className?: string
  /** 래퍼가 세로 스크롤도 맡는다(`THead sticky` 를 쓸 때). 부모는 높이가 정해진 flex-col 이어야 한다 */
  scroll?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        // 카드는 모서리를 가려야 하지만 overflow-x-auto 가 이미 클립한다(overflow-hidden 은 x 스크롤을 막으므로 쓰지 않는다)
        scroll ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto',
        variant === 'card' ? 'rounded-w-lg border' : '[&_tbody]:border-b',
        className
      )}
    >
      <table className={cn('w-full text-left text-sm', tableClassName)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

/** 머리 행(thead > tr). `sticky` 면 스크롤 영역 위에 붙는다(전체 폭형 목록) — 반드시 `DataTable scroll` 과 함께 */
export function THead({
  sticky = false,
  className,
  children,
}: {
  sticky?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <thead
      className={cn(
        'border-b text-xs font-medium text-muted-foreground',
        // 반투명 머리 배경 아래로 본문이 비치지 않게 바탕을 한 겹 깐다
        sticky && 'sticky top-0 z-10 bg-background',
        className
      )}
    >
      <tr>{children}</tr>
    </thead>
  )
}

/** 머리 칸 — `scope="col"`, 숫자 칸은 `numeric` */
export function Th({
  numeric = false,
  className,
  children,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      {...props}
      className={cn(
        'bg-muted/50 px-4 py-2 text-left align-middle font-medium whitespace-nowrap',
        numeric && 'text-right',
        className
      )}
    >
      {children}
    </th>
  )
}

export function TBody({ className, children }: { className?: string; children: ReactNode }) {
  return <tbody className={cn('divide-y', className)}>{children}</tbody>
}

/** 본문 행 — `interactive` 면 hover 배경 */
export function Tr({
  interactive = false,
  className,
  children,
  ...props
}: ComponentProps<'tr'> & { interactive?: boolean }) {
  return (
    <tr {...props} className={cn(interactive && 'hover:bg-muted', className)}>
      {children}
    </tr>
  )
}

/**
 * 본문 칸. `numeric` = 숫자·금액(오른쪽 정렬 + tabular-nums + 줄바꿈 없음), `nowrap` = 날짜처럼 줄바꿈 없는 칸(+ tabular-nums),
 * `dense` = 밀집 표(`py-2`).
 */
export function Td({
  numeric = false,
  nowrap = false,
  dense = false,
  className,
  children,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean; nowrap?: boolean; dense?: boolean }) {
  return (
    <td
      {...props}
      className={cn(
        'px-4 align-middle',
        dense ? 'py-2' : 'py-3',
        numeric && 'text-right whitespace-nowrap tabular-nums',
        nowrap && 'whitespace-nowrap tabular-nums',
        className
      )}
    >
      {children}
    </td>
  )
}
