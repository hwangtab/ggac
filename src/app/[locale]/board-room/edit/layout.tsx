import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { WORK_PANE_HEIGHT_CLASS } from '@work/components/layout/work-layout'
import '@work/styles.css'

export const metadata: Metadata = {
  title: { default: '문서 편집', template: '%s · 문서 편집' },
  robots: { index: false, follow: false },
}

/**
 * **반드시 동적 렌더링** — `(work)/layout.tsx`와 같은 이유(가드가 세션 쿠키를 읽는다. 정적 생성되면 로그인 리다이렉트가 구워진다).
 */
export const dynamic = 'force-dynamic'

/**
 * 앱 안 편집 화면의 레이아웃 — 원본 kosmart-work `app/edit/layout.tsx`(docs/11 §2-2). 편집 공간을 최대로 쓰려고
 * 목록 칸(WorkShell)을 그리지 않는다. 전역 내비와 이사회실 레이아웃 **안에서** 열리고(docs/board-work/03-통합-재설계.md
 * §8 결정 2), 이사회실 메뉴는 이 경로에서 기본으로 접힌다('메뉴 펼치기'·'넓게 보기' — board-room/layout.tsx). 편집기는
 * 콘텐츠 칸 전체 폭과 화면에 맞춘 높이(업무 화면과 같은 값)를 쓴다. PC 전용 판정은 각 화면의 DesktopOnlyGate가 한다.
 * 게이트: requireWorkStaff(이사·감사·관리자, 원본 requireStaff 자리). 페이지가 파일별 권한(canEdit)을 다시 본다.
 */
export default async function EditLayout({ children }: { children: ReactNode }) {
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
