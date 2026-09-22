import { NOINDEX_METADATA } from '@/constants/seo'

// 이 페이지는 'use client'라 metadata를 내보낼 수 없다. 색인 차단을 여기서 건다.
export const metadata = NOINDEX_METADATA

export default function FundingManageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
