import { useMemo } from 'react'
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  type ReadonlyURLSearchParams,
} from 'next/navigation'
import { fromWorkPathname, localeOfPathname, toWorkHref } from './paths'

/**
 * 옮긴 화면 코드가 `next/navigation` 대신 쓰는 모듈(옮기기 스크립트가 import를 바꾼다) — 경로 변환은 ./paths.ts.
 *
 * - `usePathname()`  원본 모양(`/inbox`·`/c/<slug>`)으로 돌려준다 — 원본의 `startsWith('/inbox')` 비교가 그대로 맞는다.
 * - `useRouter()`    `push`·`replace`·`prefetch`의 주소를 ggac 경로로 바꾼다. `refresh`·`back`·`forward`는 그대로.
 * - 나머지(`notFound`·`redirect`·`useSearchParams`·`useParams` …)는 next/navigation 그대로 다시 내보낸다.
 *   `redirect()`는 바꾸지 않는다 — 서버 코드는 ggac가 새로 쓴 페이지에만 있고 거기서는 ggac 경로를 직접 쓴다.
 *
 * 'use client'를 붙이지 않는다: 서버 컴포넌트가 `notFound`를 이 모듈로 가져와도 되게(훅은 클라이언트에서만 부른다).
 */
export * from 'next/navigation'
export type { ReadonlyURLSearchParams }

export function usePathname(): string {
  return fromWorkPathname(useNextPathname()) as string
}

type NextRouter = ReturnType<typeof useNextRouter>

export function useRouter(): NextRouter {
  const router = useNextRouter()
  const locale = localeOfPathname(useNextPathname())
  return useMemo<NextRouter>(
    () => ({
      ...router,
      push: (href, options) => router.push(toWorkHref(href, locale), options),
      replace: (href, options) => router.replace(toWorkHref(href, locale), options),
      prefetch: (href, options) => router.prefetch(toWorkHref(href, locale), options),
    }),
    [router, locale]
  )
}
