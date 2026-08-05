import type { Metadata } from 'next'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import {
  generateFAQStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { Link } from '@/i18n/navigation'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import FAQAccordion from '@/components/FAQAccordion'
import { getFaqData } from '@/lib/data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  return {
    title: isEn ? 'FAQ' : '자주 묻는 질문',
    description: isEn
      ? 'Frequently asked questions about Gyeonggi Art Collective — membership, activities, collaboration, and more.'
      : '조합 가입, 활동, 협업을 두고 자주 나오는 질문과 답을 모아 뒀습니다.',
    keywords: [
      'FAQ',
      '자주 묻는 질문',
      '조합원 가입',
      '협동조합',
      '예술가 지원',
      '문화예술',
      '경기아트콜렉티브',
    ],
    alternates: getLocaleAlternates('/faq', locale),
    openGraph: {
      title: isEn ? 'FAQ | Gyeonggi Art Collective' : '자주 묻는 질문 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Frequently asked questions about Gyeonggi Art Collective — membership, activities, collaboration, and more.'
        : '경기아트콜렉티브 협동조합에 대해 자주 묻는 질문과 답변',
      url: isEn ? `${base}/en/faq` : `${base}/faq`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      type: 'website',
      locale: getOgLocale(locale),
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합 - 자주 묻는 질문',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn ? 'FAQ | Gyeonggi Art Collective' : '자주 묻는 질문 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Frequently asked questions about Gyeonggi Art Collective — membership, activities, collaboration, and more.'
        : '경기아트콜렉티브 협동조합에 대해 자주 묻는 질문과 답변',
      images: ['/images/logo/gac_og.webp'],
    },
  }
}

interface FAQPageProps {
  params: Promise<{ locale: string }>
}

export default async function FAQPage({ params }: FAQPageProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('faq')
  const faqData = await getFaqData(locale)

  // 구조화된 데이터 생성
  const faqSchema = generateFAQStructuredData(
    faqData.map(item => ({
      question: item.question,
      answer: item.answer,
    }))
  )

  const breadcrumbData = generateBreadcrumbStructuredData([
    { name: '홈', url: 'https://ggac.kr' },
    { name: '자주 묻는 질문', url: 'https://ggac.kr/faq' },
  ])

  const structuredData = combineStructuredData([faqSchema, breadcrumbData])

  // 카테고리별로 그룹화
  type FaqItem = (typeof faqData)[number]
  const groupedFAQs = faqData.reduce(
    (acc, faq) => {
      if (!acc[faq.category]) {
        acc[faq.category] = []
      }
      acc[faq.category].push(faq)
      return acc
    },
    {} as Record<string, FaqItem[]>
  )

  return (
    <>
      {structuredDataToScript(structuredData)}
      <div className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto px-4">
              {/* 헤더 */}
              <div className="text-center mb-12">
                <h1 className="tw-heading-primary mb-4">{t('heading')}</h1>
                <p className="tw-text-body text-gray-600">{t('subheading')}</p>
              </div>

              {/* FAQ 섹션별 표시 */}
              {Object.entries(groupedFAQs).map(([category, faqs]) => (
                <div key={category} className="mb-12">
                  <h2 className="tw-heading-tertiary mb-6 text-primary-700">{category}</h2>
                  <FAQAccordion faqs={faqs} />
                </div>
              ))}

              {/* CTA 섹션 */}
              <div className="mt-16 p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 text-center">
                <h3 className="tw-heading-tertiary mb-4">{t('ctaTitle')}</h3>
                <p className="text-gray-600 mb-6">{t('ctaBody')}</p>
                <Link
                  href="/connect"
                  className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors duration-200"
                >
                  {t('ctaButton')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
