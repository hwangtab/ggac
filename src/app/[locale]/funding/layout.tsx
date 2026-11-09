import type { ReactNode } from 'react'
import SegmentIntl from '@/i18n/SegmentIntl'
import { SEGMENT_NAMESPACES } from '@/i18n/segmentNamespaces'

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return <SegmentIntl namespaces={SEGMENT_NAMESPACES['funding']}>{children}</SegmentIntl>
}
