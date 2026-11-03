import type { ComponentType, ReactNode } from 'react'
import { cn } from '@work/lib/utils'

/**
 * 화면 공통 부품 — docs/13-UI-규약.md §2~§5.
 * 모든 메인 화면은 PageHeader(h-12 머리글) + PageBody(폭 변형 4종) 로 시작하고,
 * 섹션 제목은 SectionHeading, 빈 화면은 EmptyState 를 쓴다.
 */

type PageHeaderProps = {
  /** 화면 제목(h1). 머리글 h-12 안에 한 줄로 */
  title: ReactNode
  /** 제목 옆 보조 글(건수·설명) */
  subtitle?: ReactNode
  /** 제목 왼쪽 아이콘 */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  /** 오른쪽 작업 버튼 묶음 */
  actions?: ReactNode
  /**
   * 모바일에서는 TopBar 가 섹션 이름을 그리므로 제목을 시각적으로 숨긴다(sr-only 로 h1 은 남긴다).
   * actions 가 있으면 머리글 줄은 모바일에도 남아 작업 버튼만 보이고, 없으면 줄 전체가 숨는다.
   */
  hideOnMobile?: boolean
  /** h1 대신 다른 태그(우측 패널 등 중첩 영역) */
  as?: 'h1' | 'h2'
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  hideOnMobile = false,
  as: Heading = 'h1',
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-2 border-b px-4',
        hideOnMobile && !actions && 'hidden md:flex',
        hideOnMobile && actions && 'justify-end md:justify-start',
        className
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 items-baseline gap-2',
          hideOnMobile && 'sr-only md:not-sr-only md:flex'
        )}
      >
        <Heading className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
          {Icon && <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{title}</span>
        </Heading>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}

/** 본문 폭 변형(§3): default 3xl · narrow 2xl(설정·폼) · wide 5xl(테이블) · full(대화·뷰어) */
export type PageWidth = 'default' | 'narrow' | 'wide' | 'full'

const WIDTH_CLASS: Record<PageWidth, string> = {
  default: 'max-w-3xl',
  narrow: 'max-w-2xl',
  wide: 'max-w-5xl',
  full: '',
}

export function PageBody({
  width = 'default',
  children,
  className,
  innerClassName,
  /** 스크롤 영역을 만들지 않는다(부모가 이미 스크롤할 때) */
  noScroll = false,
}: {
  width?: PageWidth
  children: ReactNode
  className?: string
  innerClassName?: string
  noScroll?: boolean
}) {
  return (
    <div className={cn('min-h-0 flex-1', !noScroll && 'overflow-y-auto', className)}>
      <div
        className={cn(
          'mx-auto w-full space-y-6 px-4 py-4 md:px-6 md:py-5',
          WIDTH_CLASS[width],
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** 섹션 제목(h2) + 보조 수 — `text-sm font-semibold` */
export function SectionHeading({
  children,
  count,
  actions,
  id,
  as: Heading = 'h2',
  className,
}: {
  children: ReactNode
  /** 건수 등 보조 글(제목 뒤, 흐린 글자) */
  count?: ReactNode
  actions?: ReactNode
  id?: string
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={cn('flex min-h-7 items-center gap-2', className)}>
      <Heading id={id} className="flex-1 text-sm font-semibold">
        {children}
        {count !== undefined && count !== null && (
          <span className="ml-1.5 font-normal text-muted-foreground">{count}</span>
        )}
      </Heading>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

/** 빈 상태(§5): 아이콘 → 제목 → 설명 → 버튼. 세로 중앙 정렬 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  /** 제목 태그(화면 전체 빈 상태면 h1, 섹션 안이면 h2/p) */
  as: Heading = 'h2',
  /** 작게(목록 안 빈 문구 — 아이콘 없이 한 줄) */
  compact = false,
  bordered = false,
  className,
}: {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  as?: 'h1' | 'h2' | 'p'
  compact?: boolean
  /** compact 를 테두리 상자로(관리 목록처럼 표 자리에 들어갈 때) */
  bordered?: boolean
  className?: string
}) {
  if (compact) {
    return (
      <p
        className={cn(
          'px-4 py-6 text-center text-sm text-muted-foreground',
          bordered && 'rounded-w-lg border',
          className
        )}
      >
        {title}
      </p>
    )
  }
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className
      )}
    >
      {Icon && <Icon aria-hidden="true" className="size-10 text-muted-foreground" />}
      <Heading className="text-base font-semibold">{title}</Heading>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

/** 안내 띠(§5): 아이콘 + 한 줄 문구 */
export function NoticeBanner({
  icon: Icon,
  children,
  tone = 'muted',
  variant = 'box',
  role = 'note',
  label,
  className,
}: {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  children: ReactNode
  /** 접근성 이름(aria-label) — 제목 줄이 따로 없는 띠에 */
  label?: string
  tone?: 'muted' | 'destructive'
  /** box = 본문 안 둥근 상자(기본) · bar = 화면 전폭 띠(머리글 아래·도구 줄, border-b) */
  variant?: 'box' | 'bar'
  /** 기본 note(정적 안내). 나중에 바뀌는 상태(저장 결과 등)만 status/alert 를 명시 */
  role?: 'status' | 'alert' | 'note'
  className?: string
}) {
  return (
    <div
      role={role}
      aria-label={label}
      className={cn(
        'flex items-start gap-2 text-sm',
        variant === 'box' ? 'rounded-w-lg border px-4 py-3' : 'shrink-0 border-b px-4 py-2',
        tone === 'muted' && 'bg-muted/50',
        tone === 'destructive' && 'bg-destructive/5 text-destructive',
        tone === 'destructive' && variant === 'box' && 'border-destructive/30',
        className
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-4 shrink-0',
            tone === 'muted' ? 'text-muted-foreground' : 'text-destructive'
          )}
        />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
