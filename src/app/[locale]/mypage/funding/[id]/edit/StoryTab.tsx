'use client'

/**
 * 스토리 탭 — 최소 스텁. Task 5가 이 자리에 마크다운 편집기와 본문 이미지
 * 업로드를 채운다.
 *
 * 껍데기(`page.tsx`)가 `story` 상태를 소유하고 여기 내려보낸다 — 이 탭은
 * 언마운트되지 않고 `hidden`으로만 감춰지므로(탭 전환 시 입력 보존), 상태를
 * 여기서 들고 있어도 사라지지는 않지만 "저장하지 않은 변경"을 껍데기가
 * 한곳에서 판단하려면 값 자체는 위로 올려야 한다. 그래서 값은 props로
 * 받고 변경은 `onChange`로만 알린다(제어 컴포넌트).
 *
 * `editScope`가 `'none'`이면 읽기 전용으로 그려야 한다 — 아직 실제 입력이
 * 없어 이 스텁에서는 참고용으로만 받는다.
 */
import { useTranslations } from 'next-intl'

export interface StoryTabProps {
  story: string
  onChange: (story: string) => void
  editScope: 'all' | 'contentOnly' | 'none'
}

export default function StoryTab({}: StoryTabProps) {
  const t = useTranslations('funding')
  return <p className="text-sm text-gray-600">{t('creator.storyPlaceholder')}</p>
}
