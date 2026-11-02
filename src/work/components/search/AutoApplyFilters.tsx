'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from '@work/lib/nav/navigation'

/**
 * GET 필터 폼의 select·날짜 입력을 바꾸면 곧바로 반영한다(QA #13) — "검색" 단추를 다시 누르지 않아도 된다.
 * 폼 안 아무 곳에 두면 가장 가까운 <form> 의 change 이벤트를 듣고, 폼 값으로 URL 쿼리를 만들어 이동한다
 * (빈 값은 뺀다 — 페이지 번호처럼 폼에 없는 값은 자연히 처음으로 돌아간다).
 * JS 가 없으면 아무 일도 하지 않으므로 폼은 그대로 "검색" 단추로 제출된다.
 */
export function filterFormHref(form: HTMLFormElement): string {
  const action = form.getAttribute('action') || window.location.pathname
  const sp = new URLSearchParams()
  for (const [k, v] of new FormData(form)) {
    if (typeof v === 'string' && v.trim() !== '') sp.set(k, v)
  }
  const qs = sp.toString()
  return qs ? `${action}?${qs}` : action
}

export default function AutoApplyFilters() {
  const router = useRouter()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const form = ref.current?.closest('form')
    if (!form) return
    function onChange(e: Event) {
      const t = e.target
      const isSelect = t instanceof HTMLSelectElement
      const isDate = t instanceof HTMLInputElement && t.type === 'date'
      if (!isSelect && !isDate) return
      // 날짜를 지우는 중 등 형식이 덜 찬 값은 브라우저가 '' 로 준다 — 그대로 반영해도 필터가 풀릴 뿐이다.
      router.push(filterFormHref(form!))
    }
    form.addEventListener('change', onChange)
    return () => form.removeEventListener('change', onChange)
  }, [router])

  return <span ref={ref} hidden />
}
