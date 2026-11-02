import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
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
 * 앱 안 편집 화면의 셸 밖 레이아웃 — 원본 kosmart-work `app/edit/layout.tsx`(docs/11 §2-2). 편집 공간을 최대로 쓰려고
 * 레일·목록 패널(AppShell)을 그리지 않는다. `edit`는 BOARD_WORK_SEGMENTS 라 전역 내비·이사회실 메뉴도 비켜 준다.
 * 게이트: requireWorkStaff(이사·감사·관리자, 원본 requireStaff 자리). 페이지가 파일별 권한(canEdit)을 다시 본다.
 */
export default async function EditLayout({ children }: { children: ReactNode }) {
  await requireWorkStaff()
  return (
    <div data-work-app className="flex min-h-dvh flex-col bg-background font-sans text-foreground">
      {children}
    </div>
  )
}
