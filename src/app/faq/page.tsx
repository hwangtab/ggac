import { Metadata } from 'next'
import {
  generateFAQStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import FAQAccordion from '@/components/FAQAccordion'
import faqData from '../../../data/faq.json'

export const metadata: Metadata = {
  title: '자주 묻는 질문 | 경기아트콜렉티브 협동조합',
  description:
    '경기아트콜렉티브 협동조합에 대해 자주 묻는 질문과 답변입니다. 조합 가입, 활동, 협업, 후원 등에 대한 정보를 확인하세요.',
  keywords: [
    'FAQ',
    '자주 묻는 질문',
    '조합원 가입',
    '협동조합',
    '예술가 지원',
    '문화예술',
    '경기아트콜렉티브',
  ],
  openGraph: {
    title: '자주 묻는 질문 | 경기아트콜렉티브 협동조합',
    description: '경기아트콜렉티브 협동조합에 대해 자주 묻는 질문과 답변',
    url: 'https://ggac.kr/faq',
    siteName: '경기아트콜렉티브 협동조합',
    type: 'website',
    locale: 'ko_KR',
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
    title: '자주 묻는 질문 | 경기아트콜렉티브 협동조합',
    description: '경기아트콜렉티브 협동조합에 대해 자주 묻는 질문과 답변',
    images: ['/images/logo/gac_og.webp'],
  },
  alternates: {
    canonical: '/faq',
  },
}

export default function FAQPage() {
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
  const groupedFAQs = faqData.reduce(
    (acc, faq) => {
      if (!acc[faq.category]) {
        acc[faq.category] = []
      }
      acc[faq.category].push(faq)
      return acc
    },
    {} as Record<string, typeof faqData>
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
                <h1 className="tw-heading-primary mb-4">자주 묻는 질문</h1>
                <p className="tw-text-body text-gray-600">
                  경기아트콜렉티브 협동조합에 대해 궁금하신 점을 확인해보세요
                </p>
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
                <h3 className="tw-heading-tertiary mb-4">더 궁금한 점이 있으신가요?</h3>
                <p className="text-gray-600 mb-6">답변을 찾지 못하셨다면 언제든지 문의해주세요</p>
                <a
                  href="/connect"
                  className="inline-block px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors duration-200"
                >
                  문의하기
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
