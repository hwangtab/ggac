import { Link } from '@/i18n/navigation'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { FiPlay, FiExternalLink, FiUser, FiLink, FiFolder } from 'react-icons/fi'
import OptimizedImage from '@/components/OptimizedImage'
import YouTubeEmbed from '@/components/YouTubeEmbed'
import ArtistProjects from '@/components/ArtistProjects'
import { convertUrlsToMarkdownLinks } from '@/utils/markdown'
import { getArtistSlugs, getArtistBySlug, getArtistProjects, type Artist } from '@/lib/data'
import { localizeArtistCategory } from '@/constants/categories'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { getSiteUrl, getLocaleAlternates, getOgLocale } from '@/utils/site'
import { sanitizeJsonLd } from '@/utils/sanitize'
import {
  toSafeArtistImageSrc,
  toSafeEmailHref,
  toSafeHttpUrl,
  toSafeLinkHref,
  toSafePhoneHref,
} from '@/utils/safeUrl'
import {
  generateArtistStructuredData,
  generateBreadcrumbStructuredData,
  combineStructuredData,
  structuredDataToScript,
} from '@/utils/structuredData'

// ISR 최적화: 개별 아티스트 페이지는 12시간 캐시
export const revalidate = 43200

// 탈퇴/삭제된 아티스트 슬러그: Google 색인에서 빠르게 제외하기 위해
// noindex 메타데이터 + 404 응답을 명시적으로 반환한다.
const WITHDRAWN_SLUGS = new Set(['rosalyn-song', 'simon-dm'])

interface ArtistPageProps {
  params: Promise<{
    locale: string
    slug: string
  }>
}

// generateStaticParams 개선 - 환경 변수 안전성 체크 추가
export async function generateStaticParams() {
  try {
    const slugs = await getArtistSlugs()
    return slugs.filter(slug => !WITHDRAWN_SLUGS.has(slug)).map(slug => ({ slug }))
  } catch (error) {
    console.warn('Failed to generate static params for artists:', error)
    // 빌드 시점에서 환경 변수가 없을 때 빈 배열 반환
    return []
  }
}

// 안정적인 베이스 URL 생성
function getBaseUrl(): string {
  return getSiteUrl()
}

// generateMetadata 개선 - 캐싱된 함수 사용
export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const resolvedParams = await params

  if (WITHDRAWN_SLUGS.has(resolvedParams.slug)) {
    return {
      title: 'Artist Not Found',
      robots: { index: false, follow: false },
    }
  }

  const artist = await getArtistBySlug(resolvedParams.slug, resolvedParams.locale)

  if (!artist) {
    return {
      title: 'Artist Not Found',
      robots: { index: false, follow: true },
    }
  }

  const isEn = resolvedParams.locale === 'en'
  const siteNameLabel = isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브'
  const title = `${artist.name} | ${siteNameLabel}`
  const description =
    artist.oneLiner ||
    (isEn
      ? `Artist ${artist.name} of Gyeonggi Art Collective`
      : `경기아트콜렉티브 소속 아티스트 ${artist.name}의 프로필`)
  const baseUrl = getBaseUrl()
  const pageUrl = `${baseUrl}/artists/${artist.slug}`

  // OG 이미지 결정 로직 — 화면 렌더링과 동일한 안전 경계(toSafeArtistImageSrc)를 거친다.
  // 신뢰 경로(내부 경로·artists 버킷 URL)만 통과하므로 임의 외부 URL이 OG에 새지 않는다.
  // 내부 정적 경로는 빌드시 `.jpg` 컴패니언이 함께 생성되므로, KakaoTalk 등 webp 미인식
  // 플랫폼을 위해 `.webp`→`.jpg`로 치환한다. 반면 Supabase Storage 업로드본의 JPEG 변형은
  // `*.fallback.jpg` 경로라 단순 확장자 치환으로는 존재하지 않는 객체(404)를 가리키게 되므로,
  // 절대 URL(업로드본)은 실제 저장된 객체를 그대로 서빙한다.
  const buildOgImageUrl = () => {
    const source = toSafeArtistImageSrc(artist.profileImage)
    const isAbsolute = /^https?:\/\//i.test(source)
    if (isAbsolute) {
      return source
    }
    return `${baseUrl}${source}`.replace(/\.webp(\?.*)?$/i, '.jpg$1')
  }

  const ogImageUrl = buildOgImageUrl()

  return {
    title: artist.name,
    description,
    alternates: getLocaleAlternates(`/artists/${artist.slug}`, resolvedParams.locale),
    keywords: [
      '경기아트콜렉티브',
      '예술가',
      '협동조합',
      artist.name,
      ...(Array.isArray(artist.category) ? artist.category : [artist.category]),
    ],
    authors: [{ name: artist.name }],
    creator: artist.name,
    publisher: isEn ? 'Gyeonggi Art Collective Cooperative' : '경기아트콜렉티브 협동조합',

    // Open Graph 메타데이터
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: isEn ? 'Gyeonggi Art Collective' : '경기아트콜렉티브 협동조합',
      type: 'profile',
      locale: getOgLocale(resolvedParams.locale),
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: isEn ? `${artist.name} profile photo` : `${artist.name} 프로필 사진`,
        },
      ],
    },

    // Twitter 메타데이터
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },

    // 추가 메타데이터
    other: {
      // 추가 OG 태그들
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:image:type': 'image/jpeg',
      'og:image:alt': isEn ? `${artist.name} profile photo` : `${artist.name} 프로필 사진`,

      // 기본 메타 태그
      'application-name': siteNameLabel,
      'apple-mobile-web-app-title': siteNameLabel,
      'theme-color': '#ffffff',
    },

    // 로봇 최적화
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

const ArtistDetailPage = async ({ params }: ArtistPageProps) => {
  const resolvedParams = await params
  setRequestLocale(resolvedParams.locale)

  const t = await getTranslations('artists')

  // 탈퇴 아티스트는 즉시 404
  if (WITHDRAWN_SLUGS.has(resolvedParams.slug)) {
    notFound()
  }

  const artist = await getArtistBySlug(resolvedParams.slug, resolvedParams.locale)

  if (!artist) {
    notFound()
  }

  // 아티스트가 참여한 프로젝트들 조회
  const artistProjects = await getArtistProjects(artist.id, resolvedParams.locale)

  const isMinimal = artist.templateType === 'minimal'
  const baseUrl = getBaseUrl()
  const safeProfileImage = toSafeArtistImageSrc(artist.profileImage)
  const artistEmailHref = toSafeEmailHref(artist.contact)
  const artistPhoneHref = toSafePhoneHref(artist.contact)
  const safePortfolioLinks =
    artist.portfolioLinks
      ?.map(link => ({ link, safeUrl: toSafeHttpUrl(link.url) }))
      .filter((item): item is { link: (typeof artist.portfolioLinks)[number]; safeUrl: string } =>
        Boolean(item.safeUrl)
      ) ?? []
  const youtubeChannelLink = safePortfolioLinks.find(
    ({ link, safeUrl }) =>
      link.title.toLowerCase().includes('youtube') || safeUrl.includes('youtube.com')
  )

  // 구조화된 데이터 생성 - 유틸리티 함수 사용
  const artistSchema = generateArtistStructuredData({
    name: artist.name,
    slug: resolvedParams.slug,
    bio: artist.oneLiner,
    categories: Array.isArray(artist.category) ? artist.category : [artist.category],
    // 화면·OG와 동일한 안전 경계를 통과한 값만 JSON-LD image로 노출한다.
    profilePhotoUrl: safeProfileImage,
    portfolioLinks: artist.portfolioLinks,
  })

  // 브레드크럼 추가
  const breadcrumbData = generateBreadcrumbStructuredData([
    { name: '홈', url: baseUrl },
    { name: '아티스트', url: `${baseUrl}/artists` },
    { name: artist.name, url: `${baseUrl}/artists/${resolvedParams.slug}` },
  ])

  // 여러 스키마 결합
  const jsonLd = combineStructuredData([artistSchema, breadcrumbData])

  return (
    <>
      {/* JSON-LD 구조화 데이터 */}
      {structuredDataToScript(jsonLd)}

      <div className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
        {/* Header */}
        <section className="py-16 md:py-24">
          <div className="tw-container-custom">
            <div className="max-w-4xl mx-auto px-4">
              <div className="mb-6">
                <Link
                  href="/artists"
                  className="inline-flex items-center text-primary-600 hover:text-primary-700 transition-colors duration-200"
                >
                  {t('detail.backLink')}
                </Link>
              </div>

              <div
                className={`${isMinimal ? 'text-center' : 'grid lg:grid-cols-2 gap-8 items-center'}`}
              >
                {/* Profile Image */}
                <div className={`${isMinimal ? 'mb-8' : ''} flex justify-center`}>
                  <div
                    className={`${isMinimal ? 'w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 max-w-[90vw] max-h-[90vw]' : 'w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 max-w-[40vw] max-h-[40vw]'} overflow-hidden rounded-full relative`}
                  >
                    <OptimizedImage
                      src={safeProfileImage}
                      alt={artist.name}
                      width={400}
                      height={400}
                      className="rounded-full object-cover w-full h-full"
                      priority={true}
                      sizes="(max-width: 640px) 90vw, (max-width: 768px) 320px, 400px"
                    />
                  </div>
                </div>

                {/* Basic Info */}
                <div>
                  {/* 카테고리 태그 */}
                  <div className={`mb-4 ${isMinimal ? 'text-center' : 'category-tags-left'}`}>
                    <div className={`flex flex-wrap gap-2 ${isMinimal ? 'justify-center' : ''}`}>
                      {Array.isArray(artist.category) ? (
                        artist.category.map((cat, index) => (
                          <span
                            key={index}
                            className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full"
                          >
                            {localizeArtistCategory(cat, resolvedParams.locale)}
                          </span>
                        ))
                      ) : (
                        <span className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full">
                          {localizeArtistCategory(artist.category as string, resolvedParams.locale)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={`${isMinimal ? 'text-center' : ''}`}>
                    <h1
                      className={`${isMinimal ? 'tw-heading-secondary' : 'tw-heading-primary'} mb-4`}
                    >
                      {artist.name}
                    </h1>

                    <p className="tw-text-body text-gray-600 mb-6">{artist.oneLiner}</p>

                    {/* Contact */}
                    <div className="text-sm text-gray-500">
                      <p>
                        {t('detail.contact')}:
                        {!artist.contact || artist.contact === '' ? (
                          <span className="ml-1">{t('detail.contactPrivate')}</span>
                        ) : artistEmailHref ? (
                          <a
                            href={artistEmailHref}
                            className="hover:text-primary-600 transition-colors duration-200 underline underline-offset-4 hover:underline-offset-6 ml-1"
                          >
                            {artist.contact}
                          </a>
                        ) : artistPhoneHref ? (
                          <a
                            href={artistPhoneHref}
                            className="hover:text-primary-600 transition-colors duration-200 underline underline-offset-4 hover:underline-offset-6 ml-1"
                          >
                            {artist.contact}
                          </a>
                        ) : (
                          <span className="ml-1">{artist.contact}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bio Section */}
        <section className="py-12 sm:py-20">
          <div className="tw-container-custom">
            <div className="max-w-6xl mx-auto px-4">
              {/* 섹션 헤더 */}
              <div className="text-center mb-12">
                <div className="inline-flex items-center gap-3 mb-4">
                  <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-primary-500"></div>
                  <FiUser className="w-6 h-6 text-primary-600" />
                  <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-primary-500"></div>
                </div>
                <h2 className="tw-heading-secondary mb-3">
                  {isMinimal ? t('detail.bioHeadingMinimal') : t('detail.bioHeadingFull')}
                </h2>
                <p className="text-gray-600 max-w-2xl mx-auto">
                  {t('detail.bioDescription', { name: artist.name })}
                </p>
              </div>

              {/* Bio 컨텐츠 */}
              <div
                className={`${isMinimal ? 'max-w-4xl mx-auto px-4' : 'grid lg:grid-cols-3 gap-8 lg:gap-12'}`}
              >
                {!isMinimal && (
                  <div className="lg:col-span-1">
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
                      <div className="text-center">
                        <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-accent-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <div className="text-2xl">🎵</div>
                        </div>
                        <h3 className="tw-heading-tertiary mb-2">
                          {t('detail.creatorInfoHeading')}
                        </h3>
                        <p className="text-sm text-gray-600">{t('detail.creatorInfoBody')}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className={`${isMinimal ? '' : 'lg:col-span-2'}`}>
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-4 sm:p-6 lg:p-8 shadow-lg border border-white/20">
                    <div className="prose prose-sm sm:prose-base lg:prose-lg max-w-none">
                      <ReactMarkdown
                        components={{
                          a: ({ node, href, children, ...props }) => {
                            const safeHref = typeof href === 'string' ? toSafeLinkHref(href) : null
                            if (!safeHref) return <span {...props}>{children}</span>

                            return (
                              <a
                                href={safeHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-600 hover:text-primary-700 underline underline-offset-4 hover:underline-offset-6"
                                {...props}
                              >
                                {children}
                              </a>
                            )
                          },
                        }}
                      >
                        {convertUrlsToMarkdownLinks(artist.bio)}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Portfolio Links */}
        {safePortfolioLinks.length > 0 && (
          <section className="py-12 sm:py-20">
            <div className="tw-container-custom">
              <div className="max-w-6xl mx-auto px-4">
                {/* 섹션 헤더 */}
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 mb-4">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-accent-500"></div>
                    <FiLink className="w-6 h-6 text-accent-600" />
                    <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-accent-500"></div>
                  </div>
                  <h2 className="tw-heading-secondary mb-3">{t('detail.portfolioHeading')}</h2>
                  <p className="text-gray-600 max-w-2xl mx-auto">
                    {t('detail.portfolioDescription', { name: artist.name })}
                  </p>
                </div>

                {/* 포트폴리오 링크들 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 max-w-6xl mx-auto px-4 pb-4">
                  {safePortfolioLinks.map(({ link, safeUrl }, index) => (
                    <a
                      key={index}
                      href={safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative overflow-hidden bg-white/70 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg border border-white/20 hover:shadow-2xl hover:scale-105 transition-all duration-300 min-w-0 break-words"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900 mb-2 group-hover:text-accent-600 transition-colors duration-200 truncate">
                            {link.title}
                          </h3>
                          <p className="text-sm text-gray-600">{t('detail.portfolioLinkLabel')}</p>
                        </div>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-accent-100 to-primary-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-200 flex-shrink-0">
                          <FiExternalLink className="w-4 h-4 sm:w-5 sm:h-5 text-accent-600" />
                        </div>
                      </div>

                      {/* 호버 그라데이션 효과 */}
                      <div className="absolute inset-0 bg-gradient-to-r from-accent-500/0 via-accent-500/5 to-primary-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* YouTube Videos */}
        {artist.youtubeVideos && artist.youtubeVideos.length > 0 && (
          <section className="py-12 sm:py-20">
            <div className="tw-container-custom">
              <div className="max-w-6xl mx-auto px-4">
                {/* 섹션 헤더 */}
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 mb-4">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-red-500"></div>
                    <FiPlay className="w-6 h-6 text-red-600" />
                    <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-red-500"></div>
                  </div>
                  <h2 className="tw-heading-secondary mb-3">{t('detail.videosHeading')}</h2>
                  <p className="text-gray-600 max-w-2xl mx-auto">
                    {t('detail.videosDescription', { name: artist.name })}
                  </p>
                </div>

                {/* 비디오 그리드 */}
                <div
                  className={`
                  grid gap-6 sm:gap-8 px-4 overflow-hidden
                  ${
                    artist.youtubeVideos.length === 1
                      ? 'grid-cols-1 max-w-3xl mx-auto'
                      : artist.youtubeVideos.length === 2
                        ? 'grid-cols-1 lg:grid-cols-2'
                        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                  }
                `}
                >
                  {artist.youtubeVideos.map((video, index) => (
                    <div
                      key={index}
                      className="transform transition-all duration-500"
                      style={{
                        animationDelay: `${index * 200}ms`,
                      }}
                    >
                      <YouTubeEmbed videoUrl={video.url} title={video.title} />
                    </div>
                  ))}
                </div>

                {/* 더 많은 영상이 있을 경우의 안내 */}
                {artist.youtubeVideos.length > 0 && (
                  <div className="text-center mt-12">
                    <p className="text-gray-500 text-sm mb-4">{t('detail.moreVideosNote')}</p>
                    {/* 포트폴리오 링크 중 YouTube가 있다면 버튼 표시 */}
                    {youtubeChannelLink && (
                      <a
                        href={youtubeChannelLink.safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors duration-200 font-medium"
                      >
                        <FiExternalLink className="w-4 h-4" />
                        {t('detail.youtubeChannelCta')}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 참여 프로젝트 섹션 */}
        {artistProjects.length > 0 && (
          <section className="py-12 sm:py-20">
            <div className="tw-container-custom">
              <div className="max-w-6xl mx-auto px-4">
                {/* 섹션 헤더 */}
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 mb-4">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-primary-500"></div>
                    <FiFolder className="w-6 h-6 text-primary-600" />
                    <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-primary-500"></div>
                  </div>
                  <h2 className="tw-heading-secondary mb-3">{t('detail.projectsHeading')}</h2>
                  <p className="text-gray-600 max-w-2xl mx-auto">
                    {t('detail.projectsDescription', { name: artist.name })}
                  </p>
                </div>

                {/* 프로젝트 목록 */}
                <ArtistProjects projects={artistProjects} artistName={artist.name} />
              </div>
            </div>
          </section>
        )}

        {/* Navigation */}
        <section className="pt-8 pb-12 sm:pb-20 mt-4">
          <div className="tw-container-custom">
            <div className="text-center px-4">
              <div className="max-w-2xl mx-auto mb-8">
                <h3 className="tw-heading-tertiary mb-3">{t('detail.navHeading')}</h3>
                <p className="text-gray-600">{t('detail.navBody')}</p>
              </div>
              <Link href="/artists" className="tw-btn-primary">
                {t('detail.navCta')}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default ArtistDetailPage
