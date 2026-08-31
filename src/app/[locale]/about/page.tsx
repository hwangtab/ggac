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
import PageHero from '@/components/PageHero'

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
      : '경기도 인디 뮤지션·밴드가 모여 만든 생산자 협동조합. 창립총회부터 지금까지 벌인 공연과 작업을 시간순으로 적어 뒀습니다.',
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
        : '경기도 인디 뮤지션·밴드가 모여 만든 생산자 협동조합. 창립총회부터 지금까지 벌인 공연과 작업을 시간순으로 적어 뒀습니다.',
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
        : '경기도 인디 뮤지션·밴드가 모여 만든 생산자 협동조합. 창립총회부터 지금까지 벌인 공연과 작업을 시간순으로 적어 뒀습니다.',
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

  // 목록형 문안은 메시지 파일에 배열로 둔다(Hero의 disciplines와 같은 방식).
  // 번역이 빠지면 t.raw가 배열이 아닌 값을 돌려주므로 렌더 전에 걸러낸다.
  const rawCoopDoes = t.raw('membership.coop')
  const rawMemberDoes = t.raw('membership.member')
  const coopDoes = Array.isArray(rawCoopDoes) ? (rawCoopDoes as string[]) : []
  const memberDoes = Array.isArray(rawMemberDoes) ? (rawMemberDoes as string[]) : []

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
        <PageHero
          kicker="ABOUT"
          titleLine1={t('hero.titleLine1')}
          titleLine2={t('hero.titleLine2')}
          subtitle={t('hero.subtitle')}
        />

        {/* Why a cooperative — 설립 목적 앞에서 "왜 이런 조직이 필요한가"를 먼저 깐다 */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <h2 className="tw-heading-secondary text-center mb-12">{t('why.heading')}</h2>
              <div className="prose prose-lg max-w-none">
                <p className="tw-text-body leading-relaxed mb-6">{t('why.p1')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('why.p2')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('why.p3')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('why.p4')}</p>
              </div>
            </div>
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

        {/* Governance — 1인 1표·이사회 참여·기획 자율성 */}
        <section className="py-16 md:py-24 bg-gray-50">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <h2 className="tw-heading-secondary text-center mb-12">{t('governance.heading')}</h2>
              <div className="prose prose-lg max-w-none">
                <p className="tw-text-body leading-relaxed mb-6">{t('governance.p1')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('governance.p2')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('governance.p3')}</p>
                <p className="tw-text-body leading-relaxed mb-6">{t('governance.p4')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Membership — 조합이 하는 일 / 조합원이 하는 일 */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto">
              <h2 className="tw-heading-secondary text-center mb-12">{t('membership.heading')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h3 className="font-post mb-6 text-xl font-bold tracking-tight">
                    {t('membership.coopHeading')}
                  </h3>
                  <ul className="space-y-4">
                    {coopDoes.map(item => (
                      <li key={item} className="flex">
                        <span
                          aria-hidden="true"
                          className="mr-3 mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-600"
                        />
                        <span className="tw-text-body text-base leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-post mb-6 text-xl font-bold tracking-tight">
                    {t('membership.memberHeading')}
                  </h3>
                  <ul className="space-y-4">
                    {memberDoes.map(item => (
                      <li key={item} className="flex">
                        <span
                          aria-hidden="true"
                          className="mr-3 mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-600"
                        />
                        <span className="tw-text-body text-base leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="tw-text-body mt-12 leading-relaxed">{t('membership.closing')}</p>
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
                              href={`/projects/${event.slug}`}
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
