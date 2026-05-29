'use client'

import { useTranslations } from 'next-intl'
import type { BoardMeetingStatus } from '@/constants/boardRoom'

interface StatusBadgeProps {
  status: BoardMeetingStatus
}

const statusStyles: Record<BoardMeetingStatus, string> = {
  polling: 'bg-amber-100 text-amber-800 border-amber-200',
  scheduled: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-gray-100 text-gray-600 border-gray-200',
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const t = useTranslations('boardRoom.status')

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[status]}`}
    >
      {t(status)}
    </span>
  )
}
