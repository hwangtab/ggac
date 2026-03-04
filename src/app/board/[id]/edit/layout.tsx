import { NOINDEX_METADATA } from '@/constants/seo'
import type { ReactNode } from 'react'

export const metadata = NOINDEX_METADATA

export default function BoardEditLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
