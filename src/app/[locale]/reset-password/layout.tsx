import { Suspense } from 'react'
import { NOINDEX_METADATA } from '@/constants/seo'
import type { ReactNode } from 'react'

export const metadata = NOINDEX_METADATA

// 재설정 페이지(클라이언트)가 useSearchParams(?token=)를 쓰므로 자체 Suspense
// 경계가 필요하다 — login/layout.tsx와 같은 이유(2026-07 전수감사 백로그로
// 전역 Suspense가 걷혔다)다.
export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}
