'use client'

import NextLink from 'next/link'
import { usePathname } from 'next/navigation'
import { forwardRef, type ComponentPropsWithRef } from 'react'
import { localeOfPathname, toWorkHref } from './paths'

/**
 * 옮긴 화면 코드가 `next/link` 대신 쓰는 링크(옮기기 스크립트가 import를 바꾼다) — 원본 주소(`/c/<slug>`)를
 * ggac 업무툴 주소(`/board-room/c/<slug>`, 영어면 `/en/board-room/…`)로 바꿔 그린다. 변환 규칙은 ./paths.ts.
 * 문자열이 아닌 href(객체)는 그대로 넘긴다(옮긴 코드에는 없다).
 */
const Link = forwardRef<HTMLAnchorElement, ComponentPropsWithRef<typeof NextLink>>(
  function WorkLink({ href, ...rest }, ref) {
    const locale = localeOfPathname(usePathname())
    const target = typeof href === 'string' ? toWorkHref(href, locale) : href
    return <NextLink ref={ref} href={target} {...rest} />
  }
)

export default Link
