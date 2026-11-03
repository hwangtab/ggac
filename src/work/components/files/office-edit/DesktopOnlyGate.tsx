'use client'

import type { ReactNode } from 'react'
import Link from '@work/lib/nav/link'
import { MonitorIcon } from 'lucide-work'
import { buttonVariants } from '@work/components/ui/button'
import { EmptyState } from '@work/components/layout/page'
import { useDesktopEditorKnown } from './use-desktop-editor'

/**
 * 앱 안 편집 화면(`/edit/*`)을 PC 에서만 연다(docs/11 §2-1).
 * 진입 버튼은 `useDesktopEditor` 로 숨기지만 주소로 직접 열 수 있어서(북마크·공유 링크) 화면에서도 같은 판정을 한다.
 * 판정 전(서버 렌더·하이드레이션)에는 빈 화면 — 데스크톱에서 안내가 깜빡이지 않게.
 */
export default function DesktopOnlyGate({
  backHref = '/files',
  children,
}: {
  /** 돌아갈 곳 */
  backHref?: string
  children: ReactNode
}) {
  const desktop = useDesktopEditorKnown()
  if (desktop === null) return <div className="h-dvh" aria-hidden="true" />
  if (!desktop) {
    return (
      <main id="main-content" className="flex min-h-dvh flex-col" data-testid="desktop-only-notice">
        <EmptyState
          icon={MonitorIcon}
          as="h1"
          title="PC 에서 열어 주세요"
          description="문서 편집은 넓은 화면과 마우스가 있는 PC 에서만 쓸 수 있습니다."
        >
          <Link href={backHref} className={buttonVariants({ size: 'sm' })}>
            돌아가기
          </Link>
        </EmptyState>
      </main>
    )
  }
  return <>{children}</>
}
