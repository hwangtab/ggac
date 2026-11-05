import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { WORK_PANE_HEIGHT_CLASS } from '@work/components/layout/work-layout'
import '@work/styles.css'

export const metadata: Metadata = {
  title: { default: '서류 편집', template: '%s · 서류 편집' },
  robots: { index: false, follow: false },
}

/** **반드시 동적 렌더링** — 업무툴 편집 레이아웃과 같은 이유(가드가 세션 쿠키를 읽는다) */
export const dynamic = 'force-dynamic'

/**
 * 이사회 서류 앱 편집 화면의 틀(docs/board-work/05-이사회-서류-앱-편집.md §7) — 업무툴 편집 레이아웃
 * (`/board-room/edit/layout.tsx`)과 같은 모양이다: 이사회실 레이아웃 **안에서** 열리고(좌측 메뉴는 남고 기본으로 접힌다 —
 * `isBoardWorkEditPath`), 편집기는 콘텐츠 칸 전체 폭·화면에 맞춘 높이를 쓴다. 색은 업무툴 토큰(`data-work-app` —
 * 포스터 팔레트). 게이트: requireWorkStaff(이사·감사·관리자). 페이지가 서류별 편집 권한(올린 사람·관리자)을 다시 본다.
 */
export default async function BoardDocumentEditLayout({ children }: { children: ReactNode }) {
  await requireWorkStaff()
  return (
    <div
      data-work-app
      className={`flex flex-col overflow-hidden rounded-w-lg border bg-card font-sans text-foreground ${WORK_PANE_HEIGHT_CLASS}`}
    >
      {children}
    </div>
  )
}
