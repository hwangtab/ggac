import { FaInstagram, FaYoutube } from 'react-icons/fa'
import { getGlobalData } from '@/lib/data'
import { Link } from '@/i18n/navigation'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import {
  toSafeEmailHref,
  toSafeHttpUrl,
  toSafeNaverMapSearchHref,
  toSafePhoneHref,
} from '@/utils/safeUrl'
import { serializeJsonLd } from '@/utils/structuredData'
import PageHero from '@/components/PageHero'
import JoinCta from '@/components/JoinCta'

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
    title: isEn ? 'Join & Collaborate' : '조합원 가입·협업 문의',
    description: isEn
      ? 'We are looking for artists and organizers working in Gyeonggi. Membership and collaboration inquiries welcome.'
      : '경기도에서 활동하는 예술가·기획자를 찾습니다. 조합원 가입과 협업 문의를 받습니다.',
    keywords: [
      '조합원가입',
      '예술가모집',
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
      title: isEn
        ? 'Join & Collaborate | Gyeonggi Art Collective'
        : '조합원 가입·협업 문의 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'We are looking for artists and organizers working in Gyeonggi. Membership and collaboration inquiries welcome.'
        : '경기도에서 활동하는 예술가·기획자를 찾습니다. 조합원 가입과 협업 문의를 받습니다.',
      url: isEn ? `${base}/en/connect` : `${base}/connect`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합 — 조합원 가입·협업 문의',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn
        ? 'Join & Collaborate | Gyeonggi Art Collective'
        : '조합원 가입·협업 문의 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'We are looking for artists and organizers working in Gyeonggi. Membership and collaboration inquiries welcome.'
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
  const safeInstagramUrl = toSafeHttpUrl(globalData.social.instagram)
  const safeYoutubeUrl = toSafeHttpUrl(globalData.social.youtube)
  const safeEmailHref = toSafeEmailHref(globalData.contact.email)
  const safePhoneHref = toSafePhoneHref(globalData.contact.phone)
  const safeAddressHref = toSafeNaverMapSearchHref(globalData.contact.address)

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
    sameAs: [safeInstagramUrl, safeYoutubeUrl].filter((url): url is string => Boolean(url)),
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <div className="pt-20">
        {/* Hero Section */}
        <PageHero
          kicker="CONNECT"
          titleLine1={t('heroTitleLine1')}
          titleLine2={t('heroTitleLine2')}
          subtitle={t('heroSubtitle')}
        />

        {/* Join Section */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              {/* 홈 섹션·PageHero와 같은 문법: 킥커 → 헤어라인 → 왼쪽 정렬 제목 → 부제.
                  이 페이지만 가운데 정렬 제목을 써서 같은 사이트로 읽히지 않았다. */}
              <div className="mb-10">
                <div className="flex items-center gap-3 sm:gap-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/65">
                    JOIN
                  </p>
                  <span aria-hidden="true" className="h-px flex-1 bg-white/25" />
                </div>
                <h2 className="font-post mt-6 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                  {t('joinHeading')}
                </h2>
                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70 sm:text-base">
                  {t('joinSubtitle')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                {/* 자격 */}
                <div className="h-full border border-white/15 p-8">
                  <h3 className="font-post mb-6 text-2xl font-bold tracking-tight">
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
                  <div className="mt-8 border-t border-white/15 pt-6">
                    <p className="text-sm text-gray-500">{t('qualFooter')}</p>
                  </div>
                </div>

                {/* 약속 */}
                <div className="h-full border border-white/15 p-8">
                  <h3 className="font-post mb-6 text-2xl font-bold tracking-tight">
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
                  <div className="mt-8 border-t border-white/15 pt-6">
                    <p className="text-sm leading-relaxed text-gray-500">{t('commitFooter')}</p>
                  </div>
                </div>
              </div>

              <div className="text-center">
                <JoinCta />
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              {/* 홈 섹션·PageHero와 같은 문법: 킥커 → 헤어라인 → 왼쪽 정렬 제목 → 부제.
                  이 페이지만 가운데 정렬 제목을 써서 같은 사이트로 읽히지 않았다. */}
              <div className="mb-10">
                <div className="flex items-center gap-3 sm:gap-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/65">
                    CONTACT
                  </p>
                  <span aria-hidden="true" className="h-px flex-1 bg-white/25" />
                </div>
                <h2 className="font-post mt-6 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                  {tf('contact')}
                </h2>
                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70 sm:text-base">
                  {t('contactBody')}
                </p>
              </div>

              {/*
                연락처 카드 셋은 같은 문법을 쓴다: 대문자 라벨 → 항목명 → 값.
                이메일만 원형 배지에 @ 글리프가 남아 TEL·MAP과 어긋났고,
                라운드·그림자·hover 확대도 포스터 언어(직각 + 헤어라인)와 맞지 않았다.
              */}
              <div className="grid grid-cols-1 gap-6 text-center md:grid-cols-3">
                {safeEmailHref && (
                  <a
                    href={safeEmailHref}
                    className="group border border-white/15 p-6 transition-colors duration-300 hover:border-white/50"
                  >
                    <p className="mb-4 text-[11px] uppercase tracking-[0.28em] text-white/55">
                      MAIL
                    </p>
                    <h3 className="mb-2 font-semibold">{tf('email')}</h3>
                    <p className="text-sm text-gray-600">{globalData.contact.email}</p>
                  </a>
                )}

                {safePhoneHref && (
                  <a
                    href={safePhoneHref}
                    className="group border border-white/15 p-6 transition-colors duration-300 hover:border-white/50"
                  >
                    <p className="mb-4 text-[11px] uppercase tracking-[0.28em] text-white/55">
                      TEL
                    </p>
                    <h3 className="mb-2 font-semibold">{tf('phone')}</h3>
                    <p className="text-sm text-gray-600">{globalData.contact.phone}</p>
                  </a>
                )}

                {safeAddressHref ? (
                  <a
                    href={safeAddressHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group border border-white/15 p-6 transition-colors duration-300 hover:border-white/50"
                  >
                    <p className="mb-4 text-[11px] uppercase tracking-[0.28em] text-white/55">
                      MAP
                    </p>
                    <h3 className="mb-2 font-semibold">{tf('address')}</h3>
                    <p className="text-sm text-gray-600">{globalData.contact.address}</p>
                  </a>
                ) : (
                  <div className="border border-white/15 p-6">
                    <p className="mb-4 text-[11px] uppercase tracking-[0.28em] text-white/55">
                      MAP
                    </p>
                    <h3 className="mb-2 font-semibold">{tf('address')}</h3>
                    <p className="text-sm text-gray-600">{globalData.contact.address}</p>
                  </div>
                )}
              </div>

              <div className="mt-12">
                {/* 킥커의 대문자·넓은 자간은 라틴 문자용이다. 한글에 그대로 걸면
                    "S N S에도  있습니다"처럼 낱자가 벌어진다. */}
                <p className="mb-6 text-sm text-white/60">{t('snsHeading')}</p>
                <div className="flex space-x-8">
                  {safeInstagramUrl && (
                    <a
                      href={safeInstagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center text-white/60 transition-colors duration-200 group hover:text-white"
                    >
                      <span className="mb-2 flex h-12 w-12 items-center justify-center border border-white/15 transition-colors duration-200 group-hover:border-white/50">
                        <FaInstagram className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-medium">Instagram</span>
                    </a>
                  )}
                  {safeYoutubeUrl && (
                    <a
                      href={safeYoutubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center text-white/60 transition-colors duration-200 group hover:text-white"
                    >
                      <span className="mb-2 flex h-12 w-12 items-center justify-center border border-white/15 transition-colors duration-200 group-hover:border-white/50">
                        <FaYoutube className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-medium">YouTube</span>
                    </a>
                  )}
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
