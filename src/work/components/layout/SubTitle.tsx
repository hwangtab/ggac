import type { ReactNode } from 'react'

/** 목록 패널 그룹 소제목(h3) — docs/13 §4 "소제목". 모든 패널 콘텐츠가 같이 쓴다 */
export default function SubTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-sidebar-foreground/70">
      {children}
    </h3>
  )
}
