'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'

interface LocaleSwitcherProps {
  className?: string
  activeClassName?: string
  inactiveClassName?: string
  separatorClassName?: string
}

export default function LocaleSwitcher({
  className = '',
  activeClassName = 'font-semibold',
  inactiveClassName = 'opacity-60 hover:opacity-100',
  separatorClassName = 'opacity-30',
}: LocaleSwitcherProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('locale')

  return (
    <div className={`flex items-center gap-1 text-xs ${className}`} aria-label={t('switchTo')}>
      <Link
        href={pathname}
        locale="ko"
        className={locale === 'ko' ? activeClassName : inactiveClassName}
        aria-current={locale === 'ko' ? 'true' : undefined}
      >
        KO
      </Link>
      <span className={separatorClassName} aria-hidden="true">
        |
      </span>
      <Link
        href={pathname}
        locale="en"
        className={locale === 'en' ? activeClassName : inactiveClassName}
        aria-current={locale === 'en' ? 'true' : undefined}
      >
        EN
      </Link>
    </div>
  )
}
