import { FaInstagram, FaYoutube } from 'react-icons/fa'
import { getGlobalData } from '@/lib/data'
import { Link } from '@/i18n/navigation'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'

// ISR 최적화: 연락처 정보는 24시간 캐시
export const revalidate = 86400

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const isEn = locale === 'en'
  const base = getSiteUrl()
  return {
    title: isEn ? 'Connect' : '소통과 참여',
    description: isEn
      ? 'Get in touch with Gyeonggi Art Collective. Join as a member, explore partnership opportunities, or simply say hello.'
      : '경기도 예술가들과 함께하세요. 조합원 가입, 후원, 협업 문의 등 다양한 방법으로 예술 생태계 발전에 참여할 수 있습니다.',
    keywords: [
      '조합원가입',
      '예술가모집',
      '후원',
      '협업',
      '문화예술지원',
      '경기도예술',
      '창작지원',
      '예술교육',
      '문화기획',
      '지역예술',
      '협동조합가입',
    ],
    authors: [{ name: '경기아트콜렉티브 협동조합' }],
    creator: '경기아트콜렉티브 협동조합',
    publisher: '경기아트콜렉티브 협동조합',
    alternates: getLocaleAlternates('/connect', locale),
    openGraph: {
      title: isEn ? 'Connect | Gyeonggi Art Collective' : '소통과 참여 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Get in touch with Gyeonggi Art Collective. Join as a member, explore partnership opportunities, or simply say hello.'
        : '경기도 예술가들과 함께하세요. 조합원 가입, 후원, 협업 문의 등 다양한 방법으로 예술 생태계 발전에 참여할 수 있습니다.',
      url: isEn ? `${base}/en/connect` : `${base}/connect`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합 - 소통과 참여',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn ? 'Connect | Gyeonggi Art Collective' : '소통과 참여 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Get in touch with Gyeonggi Art Collective. Join as a member, explore partnership opportunities, or simply say hello.'
        : '당신의 참여로 새로운 물결이 시작됩니다. 경기도 예술가들과 함께하세요.',
      images: ['/images/logo/gac_og.webp'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

interface ConnectPageProps {
  params: Promise<{ locale: string }>
}

const ConnectPage = async ({ params }: ConnectPageProps) => {
  const { locale } = await params
  setRequestLocale(locale)

  const [globalData, t, tf] = await Promise.all([
    getGlobalData(locale),
    getTranslations('connect'),
    getTranslations('footer'),
  ])

  // JSON-LD 구조화 데이터 - 조직 정보
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': 'https://ggac.kr#organization',
    name: '경기아트콜렉티브 협동조합',
    alternateName: 'GGAC',
    description: '경기도를 기반으로 활동하는 예술가들이 모여 설립한 생산자 협동조합',
    url: 'https://ggac.kr',
    logo: {
      '@type': 'ImageObject',
      url: 'https://ggac.kr/images/logo/gac_logo.webp',
      width: 512,
      height: 512,
    },
    image: 'https://ggac.kr/images/logo/gac_og.webp',
    foundingDate: '2025-05-01',
    foundingLocation: {
      '@type': 'Place',
      name: '경기도',
      addressRegion: '경기도',
      addressCountry: 'KR',
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: globalData.contact.address,
      addressRegion: '경기도',
      addressCountry: 'KR',
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: globalData.contact.phone,
        contactType: 'customer service',
        availableLanguage: 'Korean',
      },
      {
        '@type': 'ContactPoint',
        email: globalData.contact.email,
        contactType: 'customer service',
        availableLanguage: 'Korean',
      },
    ],
    sameAs: [globalData.social.instagram, globalData.social.youtube],
    organizationType: '협동조합',
    areaServed: {
      '@type': 'Place',
      name: '경기도',
    },
    knowsAbout: ['음악 제작', '공연 기획', '예술 교육', '문화 기획', '창작 지원'],
    memberOf: {
      '@type': 'Organization',
      name: '한국 협동조합 연합회',
    },
  }

  return (
    <>
      {/* JSON-LD 구조화 데이터 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="pt-20">
        {/* Hero Section */}
        <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
          <div className="tw-container-custom text-center">
            <h1 className="tw-heading-primary mb-6">
              {t('heroTitleLine1')}
              <br />
              {t('heroTitleLine2')}
            </h1>
            <p className="tw-text-body text-gray-600 max-w-3xl mx-auto">{t('heroSubtitle')}</p>
          </div>
        </section>

        {/* Join Section */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="tw-heading-secondary mb-4">{t('joinHeading')}</h2>
                <p className="tw-text-body text-gray-600">{t('joinSubtitle')}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                {/* 자격 */}
                <Link
                  href="/signup"
                  className="block bg-white rounded-2xl p-8 shadow-lg h-full hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
                >
                  <h3 className="text-3xl font-serif font-semibold mb-6 text-center text-primary-600 group-hover:text-primary-700 transition-colors duration-300">
                    {t('qualTitle')}
                  </h3>
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center group-hover:text-primary-600 transition-colors duration-300">
                        <span className="w-2 h-2 bg-primary-600 rounded-full mr-3 group-hover:bg-primary-700 transition-colors duration-300"></span>
                        {t('qual1Title')}
                      </h4>
                      <p className="text-sm text-gray-600 leading-relaxed ml-5 group-hover:text-primary-600 transition-colors duration-300">
                        {t('qual1Body')}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center group-hover:text-primary-600 transition-colors duration-300">
                        <span className="w-2 h-2 bg-primary-600 rounded-full mr-3 group-hover:bg-primary-700 transition-colors duration-300"></span>
                        {t('qual2Title')}
                      </h4>
                      <p className="text-sm text-gray-600 leading-relaxed ml-5 group-hover:text-primary-600 transition-colors duration-300">
                        {t('qual2Body')}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center group-hover:text-primary-600 transition-colors duration-300">
                        <span className="w-2 h-2 bg-primary-600 rounded-full mr-3 group-hover:bg-primary-700 transition-colors duration-300"></span>
                        {t('qual3Title')}
                      </h4>
                      <p className="text-sm text-gray-600 leading-relaxed ml-5 group-hover:text-primary-600 transition-colors duration-300">
                        {t('qual3Body')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <p className="text-sm text-gray-500 text-center group-hover:text-primary-600 transition-colors duration-300">
                      {t('qualFooter')}
                    </p>
                  </div>
                </Link>

                {/* 약속 */}
                <Link
                  href="/signup"
                  className="block bg-white rounded-2xl p-8 shadow-lg h-full hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
                >
                  <h3 className="text-3xl font-serif font-semibold mb-6 text-center text-accent-600 group-hover:text-accent-700 transition-colors duration-300">
                    {t('commitTitle')}
                  </h3>
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center group-hover:text-accent-600 transition-colors duration-300">
                        <span className="w-2 h-2 bg-accent-600 rounded-full mr-3 group-hover:bg-accent-700 transition-colors duration-300"></span>
                        {t('commit1Title')}
                      </h4>
                      <p className="text-sm text-gray-600 leading-relaxed ml-5 group-hover:text-accent-600 transition-colors duration-300">
                        {t('commit1Body')}
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center group-hover:text-accent-600 transition-colors duration-300">
                        <span className="w-2 h-2 bg-accent-600 rounded-full mr-3 group-hover:bg-accent-700 transition-colors duration-300"></span>
                        {t('commit2Title')}
                      </h4>
                      <p className="text-sm text-gray-600 leading-relaxed ml-5 group-hover:text-accent-600 transition-colors duration-300">
                        {t('commit2Body')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <p className="text-sm text-gray-500 text-center leading-relaxed group-hover:text-accent-600 transition-colors duration-300">
                      {t('commitFooter')}
                    </p>
                  </div>
                </Link>
              </div>

              <div className="text-center">
                <Link
                  href="/signup"
                  className="tw-btn-primary text-lg px-8 py-4 sm:px-8 sm:py-3 rounded-lg w-full sm:w-auto inline-block text-center min-h-[44px] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300"
                >
                  {t('joinCta')}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Support Section */}
        <section className="py-16 md:py-24 bg-gray-50">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="tw-heading-secondary mb-6">{t('supportHeading')}</h2>
              <p className="tw-text-body text-gray-600 mb-8 max-w-2xl mx-auto">
                {t('supportBody')}
              </p>

              <a
                href="https://docs.google.com/forms/d/e/1FAIpQLScicp159Y6DgYJv2N-x4DGigsLWiOCLf6jl-meRSfXfuMahAQ/viewform?usp=header"
                target="_blank"
                rel="noopener noreferrer"
                className="tw-btn-secondary text-lg px-8 py-4 sm:px-8 sm:py-3 rounded-lg w-full sm:w-auto text-center min-h-[44px] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300"
              >
                {t('supportCta')}
              </a>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="tw-heading-secondary mb-4">{tf('contact')}</h2>
                <p className="tw-text-body text-gray-600">{t('contactBody')}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
                <a
                  href={`mailto:${globalData.contact.email}`}
                  className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
                >
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary-200 transition-colors duration-300">
                    <span className="text-primary-600 font-semibold group-hover:scale-110 transition-transform duration-300">
                      @
                    </span>
                  </div>
                  <h3 className="font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-300">
                    {tf('email')}
                  </h3>
                  <p className="text-gray-600 text-sm group-hover:text-primary-600 transition-colors duration-300">
                    {globalData.contact.email}
                  </p>
                </a>

                <a
                  href={`tel:${globalData.contact.phone}`}
                  className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
                >
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary-200 transition-colors duration-300">
                    <span className="text-primary-600 font-semibold group-hover:scale-110 transition-transform duration-300">
                      📞
                    </span>
                  </div>
                  <h3 className="font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-300">
                    {tf('phone')}
                  </h3>
                  <p className="text-gray-600 text-sm group-hover:text-primary-600 transition-colors duration-300">
                    {globalData.contact.phone}
                  </p>
                </a>

                <a
                  href={`https://map.naver.com/v5/search/${encodeURIComponent(globalData.contact.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 group cursor-pointer"
                >
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary-200 transition-colors duration-300">
                    <span className="text-primary-600 font-semibold group-hover:scale-110 transition-transform duration-300">
                      📍
                    </span>
                  </div>
                  <h3 className="font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-300">
                    {tf('address')}
                  </h3>
                  <p className="text-gray-600 text-sm group-hover:text-primary-600 transition-colors duration-300">
                    {globalData.contact.address}
                  </p>
                </a>
              </div>

              <div className="text-center mt-12">
                <p className="text-gray-600 mb-6">{t('snsHeading')}</p>
                <div className="flex justify-center space-x-8">
                  <a
                    href={globalData.social.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center text-gray-600 hover:text-pink-600 transition-all duration-200 group transform hover:scale-105"
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 rounded-xl flex items-center justify-center mb-2 group-hover:shadow-lg transition-shadow duration-200">
                      <FaInstagram className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-sm font-medium">Instagram</span>
                  </a>
                  <a
                    href={globalData.social.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center text-gray-600 hover:text-red-600 transition-all duration-200 group transform hover:scale-105"
                  >
                    <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center mb-2 group-hover:shadow-lg transition-shadow duration-200">
                      <FaYoutube className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-sm font-medium">YouTube</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default ConnectPage
