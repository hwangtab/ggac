import BrandLoader from '@/components/BrandLoader'
import { getTranslations } from 'next-intl/server'

export default async function AdminLoading() {
  const t = await getTranslations('common')
  return <BrandLoader ariaLabel={t('loader.label')} srText={t('loader.sr')} />
}
