import { NOINDEX_METADATA } from '@/constants/seo'
import type { ReactNode } from 'react'

export const metadata = NOINDEX_METADATA

export default function SignupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
