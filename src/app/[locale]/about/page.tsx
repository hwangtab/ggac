import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { setRequestLocale, getTranslations, getLocale } from 'next-intl/server'
import { getProjects } from '@/lib/data'
import { getProjectSummary } from '@/utils/projectUtils'
import {
  generateOrganizationStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import type { Metadata } from 'next'

// ISR 최적화: 정적 콘텐츠는 24시간 캐시
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
    title: isEn ? 'Our Story' : '우리의 이야기',
    description: isEn
      ? 'Gyeonggi Art Collective traces its journey from founding assembly to present — a timeline of events, performances, and collaborations.'
      : '경기도를 기반으로 활동하는 예술가들이 모여 설립한 생산자 협동조합. 예술로 숨 쉬고, 협동으로 길을 내어 지속가능한 창작 생태계를 만들어갑니다.',
    keywords: [
      '경기아트콜렉티브',
      '협동조합',
      '경기도',
      '예술가',
      '창작자',
      '생산자협동조합',
      '예술교육',
      '음반제작',
      '공연기획',
      '문화예술',
      '지역예술',
      '예술생태계',
    ],
    authors: [{ name: '경기아트콜렉티브 협동조합' }],
    creator: '경기아트콜렉티브 협동조합',
    publisher: '경기아트콜렉티브 협동조합',
    alternates: getLocaleAlternates('/about', locale),
    openGraph: {
      title: isEn
        ? 'Our Story | Gyeonggi Art Collective'
        : '우리의 이야기 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Gyeonggi Art Collective traces its journey from founding assembly to present — a timeline of events, performances, and collaborations.'
        : '경기도를 기반으로 활동하는 예술가들이 모여 설립한 생산자 협동조합. 예술로 숨 쉬고, 협동으로 길을 내어 지속가능한 창작 생태계를 만들어갑니다.',
      url: isEn ? `${base}/en/about` : `${base}/about`,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      images: [
        {
          url: '/images/logo/gac_og.webp',
          width: 1200,
          height: 630,
          alt: '경기아트콜렉티브 협동조합 - 우리의 이야기',
        },
      ],
      locale: getOgLocale(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: isEn
        ? 'Our Story | Gyeonggi Art Collective'
        : '우리의 이야기 | 경기아트콜렉티브 협동조합',
      description: isEn
        ? 'Gyeonggi Art Collective traces its journey from founding assembly to present — a timeline of events, performances, and collaborations.'
        : '예술로 숨 쉬고, 협동으로 길을 내어 지속가능한 창작 생태계를 만들어갑니다.',
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

interface AboutPageProps {
  params: Promise<{ locale: string }>
}

const AboutPage = async ({ params }: AboutPageProps) => {
  const { locale } = await params
  setRequestLocale(locale)

  const [projects, t, currentLocale] = await Promise.all([
    getProjects(locale),
    getTranslations('about'),
    getLocale(),
  ])
  const dateLocale = currentLocale === 'en' ? 'en-US' : 'ko-KR'

  // 날짜순으로 정렬 (오래된 것부터)
  const sortedProjects = projects.sort(
    (a, b) => new Date(a.publishedDate).getTime() - new Date(b.publishedDate).getTime()
  )

  // 고정 이벤트 (조합 설립 관련)
  const fixedEvents = [
    {
      date: '2025-05-01',
      title: t('milestone.founding'),
      description: t('milestone.foundingDesc'),
      type: 'milestone',
    },
    {
      date: '2025-05-14',
      title: t('milestone.incorporation'),
      description: t('milestone.incorporationDesc'),
      type: 'milestone',
    },
  ]

  // 프로젝트를 이벤트 형태로 변환
  const projectEvents = sortedProjects.map(project => {
    const summary = getProjectSummary(project, 140)
    return {
      date: project.publishedDate,
      title: project.title,
      description: `${project.category} - ${summary}`,
      summary,
      type: 'project' as const,
      slug: project.slug,
      category: project.category,
    }
  })

  // 카테고리별 색상 매핑
  const getCategoryColor = (category: string) => {
    switch (category) {
      case '음반·음원':
        return 'bg-purple-600'
      case '공연·전시':
        return 'bg-pink-600'
      case '예술교육':
        return 'bg-green-600'
      case '지원·용역사업':
        return 'bg-blue-600'
      case '행사':
        return 'bg-orange-600'
      default:
        return 'bg-accent-600'
    }
  }

  // 모든 이벤트 통합 및 정렬
  const allEvents = [...fixedEvents, ...projectEvents].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const jsonLd = combineStructuredData([
    generateOrganizationStructuredData(),
    generateBreadcrumbStructuredData([
      { name: '홈', url: 'https://ggac.kr' },
      { name: '우리의 이야기', url: 'https://ggac.kr/about' },
    ]),
  ])

  return (
    <>
      {structuredDataToScript(jsonLd)}
      <div className="pt-20">
        {/* Hero Section */}
        <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
          <div className="tw-container-custom text-center">
            <h1 className="tw-heading-primary mb-6">
              {t('hero.titleLine1')}
              <br />
              {t('hero.titleLine2')}
            </h1>
            <p className="tw-text-body text-gray-600 max-w-3xl mx-auto">{t('hero.subtitle')}</p>
          </div>
        </section>

        {/* Mission Section */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <h2 className="tw-heading-secondary text-center mb-12">{t('mission.heading')}</h2>
              <div className="prose prose-lg max-w-none">
                <p className="tw-text-body leading-relaxed mb-6">{t('mission.p1')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('mission.p2')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('mission.p3')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('mission.p4')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('mission.p5')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Chairman Message */}
        <section className="py-16 md:py-24 bg-gray-50">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="tw-heading-secondary mb-4">{t('chairman.heading')}</h2>
                <div className="w-64 h-64 rounded-full mx-auto mb-8 overflow-hidden border-6 border-white shadow-xl">
                  <Image
                    src="/images/artists/boss.webp"
                    alt={t('chairman.imageAlt')}
                    width={256}
                    height={256}
                    className="w-full h-full object-cover"
                    priority
                  />
                </div>
                <p className="text-lg text-gray-600 font-medium">{t('chairman.name')}</p>
              </div>

              <div className="bg-white rounded-2xl p-8 shadow-lg">
                <blockquote className="tw-text-body italic leading-relaxed">
                  &ldquo;{t('chairman.quote1')}&rdquo;
                </blockquote>
                <br />
                <blockquote className="tw-text-body italic leading-relaxed">
                  &ldquo;{t('chairman.quote2')}&rdquo;
                </blockquote>
              </div>
            </div>
          </div>
        </section>

        {/* Timeline */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <h2 className="tw-heading-secondary text-center mb-12">{t('timeline.heading')}</h2>
            <div className="max-w-2xl mx-auto">
              <div className="relative">
                {/* Timeline Line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-primary-200"></div>

                {/* Timeline Items */}
                <div className="space-y-8">
                  {allEvents.map((event, index) => (
                    <div key={index} className="relative flex items-start">
                      <div
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center relative z-10 ${
                          event.type === 'milestone'
                            ? 'bg-primary-600'
                            : event.type === 'project' && 'category' in event
                              ? getCategoryColor(event.category as string)
                              : 'bg-gray-400'
                        }`}
                      >
                        <div className="w-3 h-3 bg-white rounded-full"></div>
                      </div>
                      <div className="ml-6 min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className={`text-sm font-medium ${
                              event.type === 'milestone'
                                ? 'text-primary-600'
                                : event.type === 'project'
                                  ? 'text-gray-700'
                                  : 'text-gray-600'
                            }`}
                          >
                            {new Date(event.date).toLocaleDateString(dateLocale)}
                          </div>
                          {event.type === 'project' && 'category' in event && (
                            <span
                              className={`px-2 py-1 text-xs font-medium text-white rounded-full ${getCategoryColor(event.category as string)}`}
                            >
                              {event.category as string}
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-semibold mb-2">
                          {event.type === 'project' && 'slug' in event ? (
                            <Link
                              href={`/archive/${event.slug}`}
                              className="hover:text-primary-600 transition-colors duration-200"
                            >
                              {event.title}
                            </Link>
                          ) : (
                            event.title
                          )}
                        </h3>
                        {(() => {
                          const summaryText: string =
                            event.type === 'project' && 'summary' in event
                              ? (event.summary as string)
                              : event.description
                          const displayText: string =
                            event.type === 'project'
                              ? summaryText.replace(/^[^-]*-\s*/, '')
                              : summaryText

                          return (
                            <p
                              className="text-gray-600 text-sm leading-relaxed line-clamp-2"
                              title={summaryText}
                            >
                              {displayText}
                            </p>
                          )
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default AboutPage
