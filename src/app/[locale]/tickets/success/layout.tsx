/**
 * 결제 결과 화면은 색인 대상이 아니다. 'use client' 페이지에는 메타데이터를
 * 둘 수 없으므로 세그먼트 레이아웃에서 noindex를 건다.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function TicketSuccessLayout({ children }: { children: React.ReactNode }) {
  return children
}
