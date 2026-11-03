import Link from '@work/lib/nav/link'
import { CheckIcon, CopyIcon } from 'lucide-work'
import { cn } from '@work/lib/utils'

/**
 * 자료실·채널 파일 탭의 "이전 버전 포함" 토글(링크라 JS 없이 동작, 서버 컴포넌트에서 쓴다).
 * 기본은 계보당 최신 1개만 보인다. `href` 는 토글한 뒤의 주소(호출부가 versions=all 을 켜고 끈 주소를 만든다).
 */
export default function VersionsToggle({
  active,
  href,
  className,
}: {
  /** 지금 이전 버전을 포함해 보고 있나 */
  active: boolean
  href: string
  className?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      data-tooltip={active ? '최신 버전만 보기' : '이전 버전도 함께 보기'}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-w-lg border px-3 text-xs outline-none hover:bg-accent',
        active && 'border-primary bg-subtle font-medium',
        className
      )}
    >
      {active ? (
        <CheckIcon aria-hidden="true" className="size-3.5" />
      ) : (
        <CopyIcon aria-hidden="true" className="size-3.5" />
      )}
      이전 버전 포함
      <span className="sr-only">{active ? ' (켜짐 — 누르면 최신 버전만 봅니다)' : ' (꺼짐)'}</span>
    </Link>
  )
}
