import { NOINDEX_METADATA } from '@/constants/seo'
import type { ReactNode } from 'react'
import SegmentIntl from '@/i18n/SegmentIntl'
import { SEGMENT_NAMESPACES } from '@/i18n/segmentNamespaces'

export const metadata = NOINDEX_METADATA

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return <SegmentIntl namespaces={SEGMENT_NAMESPACES['forgot-password']}>{children}</SegmentIntl>
}
