import type { ReactNode } from 'react'
import SegmentIntl from '@/i18n/SegmentIntl'
import { SEGMENT_NAMESPACES } from '@/i18n/segmentNamespaces'
import BoardRoomShell from './BoardRoomShell'

export default function BoardRoomLayout({ children }: { children: ReactNode }) {
  return (
    <SegmentIntl namespaces={SEGMENT_NAMESPACES['board-room']}>
      <BoardRoomShell>{children}</BoardRoomShell>
    </SegmentIntl>
  )
}
