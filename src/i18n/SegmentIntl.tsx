import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { pickMessages, ROOT_NAMESPACES } from './segmentNamespaces'

// 중첩 NextIntlClientProvider는 메시지를 병합하지 않고 **교체**한다. 그래서 루트 네임스페이스를
// 함께 담아 내려보낸다.
export default async function SegmentIntl({
  namespaces,
  children,
}: {
  namespaces: readonly string[]
  children: ReactNode
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()])
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={pickMessages(messages as Record<string, unknown>, [
        ...ROOT_NAMESPACES,
        ...namespaces,
      ])}
    >
      {children}
    </NextIntlClientProvider>
  )
}
