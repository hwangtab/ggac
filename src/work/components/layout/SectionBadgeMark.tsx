import { cn } from '@work/lib/utils'
import { formatBadgeCount, type SectionBadge } from './nav-sections'
import { COUNT_BADGE_CLASS } from './pane-styles'

/**
 * 레일·하단 탭 아이콘 모서리의 배지. 시각 표시는 aria-hidden, 스크린리더에는 문장만 읽힌다(NavLink 패턴).
 * 부모 링크가 `relative` 가 아니어도 되도록 아이콘을 감싼 span 안에 둔다.
 */
export default function SectionBadgeMark({ badge }: { badge?: SectionBadge }) {
  if (!badge) return null
  return (
    <>
      {badge.kind === 'dot' ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-mention"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            COUNT_BADGE_CLASS,
            'absolute -top-2 -right-3 px-1',
            badge.kind === 'mention'
              ? 'bg-mention-solid text-mention-solid-foreground'
              : 'bg-primary text-primary-foreground'
          )}
        >
          {formatBadgeCount(badge.count)}
        </span>
      )}
      <span className="sr-only">({badge.srText})</span>
    </>
  )
}
