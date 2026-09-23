'use client'

import { useTranslations } from 'next-intl'

/**
 * 캠페인 상태 배지. 목록과 대시보드가 같은 색·같은 말을 쓰도록 한 곳에 둔다.
 *
 * 색은 "지금 무엇을 기다리는가"로 고른다 — 초안은 내가 쓸 차례라 회색,
 * 심사 중은 남을 기다리는 중이라 노랑, 공개 중은 초록, 마감·정산은 끝난 일이라 파랑.
 */
const TONE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  closed: 'bg-blue-100 text-blue-800',
  settled: 'bg-blue-100 text-blue-800',
}

export default function CampaignStatusBadge({ status }: { status: string }) {
  const t = useTranslations('funding')
  const tone = TONE[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {t(`creator.status.${status}`)}
    </span>
  )
}
