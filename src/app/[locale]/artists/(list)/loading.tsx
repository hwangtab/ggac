'use client'

import { useTranslations } from 'next-intl'

import BrandLoader from '@/components/BrandLoader'

// 주의: loading.tsx에서 서버 getTranslations()를 쓰면 setRequestLocale을 호출할 수
// 없어 next-intl이 headers()로 폴백 → 세그먼트 전체가 동적 렌더링으로 강등된다.
// 클라이언트 useTranslations는 NextIntlClientProvider 컨텍스트를 읽으므로 안전하다.
export default function ArtistsLoading() {
  const t = useTranslations('common')
  return <BrandLoader ariaLabel={t('loader.label')} srText={t('loader.sr')} />
}
