'use client'

import { useEffect } from 'react'
import { AlertTriangleIcon } from 'lucide-work'
import { Button } from '@work/components/ui/button'
import { EmptyState } from '@work/components/layout/page'

/**
 * 앱 셸 안 화면에서 난 오류 — 레일·사이드바(레이아웃)는 그대로 두고 본문만 바꾼다(원본 `app/(app)/error.tsx` 자리).
 * 원본 ErrorScreen은 오류 보고(ops/client-report)를 함께 옮겨야 해서, 여기서는 같은 문구의 간단한 화면만 둔다.
 */
export default function BoardWorkError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[board-work] 화면 오류:', error)
  }, [error])
  return (
    <EmptyState
      as="h1"
      icon={AlertTriangleIcon}
      title="화면을 불러오지 못했습니다"
      description="잠시 후 다시 시도해 주세요. 계속되면 새로 고침해 주세요."
    >
      <Button type="button" size="sm" onClick={reset}>
        다시 시도
      </Button>
    </EmptyState>
  )
}
