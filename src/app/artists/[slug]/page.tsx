import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { FiPlay, FiExternalLink, FiUser, FiLink, FiFolder } from 'react-icons/fi'
import OptimizedImage from '@/components/OptimizedImage'
import YouTubeEmbed from '@/components/YouTubeEmbed'
import ArtistProjects from '@/components/ArtistProjects'
import { convertUrlsToMarkdownLinks } from '@/utils/markdown'
import { getArtistSlugs, getArtistBySlug, getArtistProjects, type Artist } from '@/lib/data'
import type { Metadata } from 'next'
import { sanitizeJsonLd } from '@/utils/sanitize'

// ISR 최적화: 개별 아티스트 페이지는 12시간 캐시
export const revalidate = 43200

interface ArtistPageProps {
  params: Promise<{
    slug: string
  }>
}

// generateStaticParams 개선 - 캐싱된 함수 사용
export async function generateStaticParams() {
  const slugs = await getArtistSlugs()
  return slugs.map((slug) => ({ slug }))
}

// 안정적인 베이스 URL 생성
function getBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return 'https://ggac.kr'
  }
  return 'http://localhost:3000'
}

// generateMetadata 개선 - 캐싱된 함수 사용
export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const resolvedParams = await params
  const artist = await getArtistBySlug(resolvedParams.slug)

  if (!artist) {
    return {
      title: 'Artist Not Found | 경기아트콜렉티브',
    }
  }

  const title = `${artist.name} | 경기아트콜렉티브`
  const description = artist.oneLiner || `경기아트콜렉티브 소속 아티스트 ${artist.name}의 프로필`
  const baseUrl = getBaseUrl()
  const pageUrl = `${baseUrl}/artists/${artist.slug}`
  
  // OG 이미지 결정 로직
  const getOgImage = () => {
    // 프로필 이미지를 JPG 버전으로 사용
    if (artist.profileImage) {
      return artist.profileImage.replace('.webp', '.jpg')
    }
    
    // 기본 로고 이미지
    return '/images/logo/gac_og.webp'
  }

  const ogImageUrl = `${baseUrl}${getOgImage()}`

  return {
    title,
    description,
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: pageUrl,
    },
    keywords: [
      '경기아트콜렉티브', 
      '예술가', 
      '협동조합', 
      artist.name, 
      ...(Array.isArray(artist.category) ? artist.category : [artist.category])
    ],
    authors: [{ name: artist.name }],
    creator: artist.name,
    publisher: '경기아트콜렉티브 협동조합',
    
    // Open Graph 메타데이터
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: '경기아트콜렉티브 협동조합',
      type: 'profile',
      locale: 'ko_KR',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${artist.name} 프로필 사진`,
        }
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
      'og:image:alt': `${artist.name} 프로필 사진`,
      
      // 기본 메타 태그
      'application-name': '경기아트콜렉티브',
      'apple-mobile-web-app-title': '경기아트콜렉티브',
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
  // 개선된 데이터 로딩 - 단일 함수로 아티스트 조회
  const artist = await getArtistBySlug(resolvedParams.slug)

  if (!artist) {
    notFound()
  }

  // 아티스트가 참여한 프로젝트들 조회
  const artistProjects = await getArtistProjects(artist.id)

  const isMinimal = artist.templateType === '미니멀형'
  const baseUrl = getBaseUrl()
  
  // 프로필 이미지 URL (JPG 버전 우선)
  const getProfileImageUrl = () => {
    if (artist.profileImage) {
      return artist.profileImage.replace('.webp', '.jpg')
    }
    return '/images/logo/gac_logo.jpg'
  }
  
  const imageUrl = `${baseUrl}${getProfileImageUrl()}`

  // JSON-LD 구조화 데이터 - XSS 방지를 위한 데이터 정제
  const sanitizeJsonLdValue = (value: any): any => {
    if (typeof value === 'string') {
      // HTML 태그와 스크립트 제거, 특수 문자 이스케이프
      return value
        .replace(/<[^>]*>/g, '') // HTML 태그 제거
        .replace(/[<>"'&]/g, (char) => { // 특수 문자 HTML 엔티티로 변환
          const map: { [key: string]: string } = {
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '&': '&amp;'
          }
          return map[char] || char
        })
        .slice(0, 500) // 길이 제한
    }
    return value
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${baseUrl}/artists/${resolvedParams.slug}#person`,
    name: sanitizeJsonLd(artist.name),
    description: sanitizeJsonLd(artist.oneLiner),
    image: {
      '@type': 'ImageObject',
      url: imageUrl,
      width: 800,
      height: 800,
    },
    url: `${baseUrl}/artists/${resolvedParams.slug}`,
    sameAs: artist.portfolioLinks?.map(link => sanitizeJsonLd(link.url)) || [],
    jobTitle: Array.isArray(artist.category)
      ? artist.category.map(cat => sanitizeJsonLd(cat)).join(', ')
      : sanitizeJsonLd(artist.category),
    memberOf: {
      '@type': 'Organization',
      '@id': `${baseUrl}#organization`,
      name: '경기아트콜렉티브 협동조합',
      url: baseUrl,
    },
    email: artist.contact?.includes('@') ? sanitizeJsonLd(artist.contact) : undefined,
    workLocation: {
      '@type': 'Place',
      name: '경기도',
    },
  }

  return (
    <>
      {/* JSON-LD 구조화 데이터 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      
      <div className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
      {/* Header */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto px-4">
            <div className="mb-6">
              <Link 
                href="/artists" 
                className="inline-flex items-center text-primary-600 hover:text-primary-700 transition-colors duration-200"
              >
                ← 아티스트 목록으로 돌아가기
              </Link>
            </div>
            
            <div className={`${isMinimal ? 'text-center' : 'grid lg:grid-cols-2 gap-8 items-center'}`}>
              {/* Profile Image */}
              <div className={`${isMinimal ? 'mb-8' : ''} flex justify-center`}>
                <div className={`${isMinimal ? 'w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 max-w-[90vw] max-h-[90vw]' : 'w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 lg:w-96 lg:h-96 max-w-[40vw] max-h-[40vw]'} overflow-hidden rounded-full relative`}>
                  <OptimizedImage
                    src={artist.profileImage}
                    alt={artist.name}
                    width={800}
                    height={800}
                    className="rounded-full object-cover w-full h-full"
                    priority={true}
                    sizes="(max-width: 768px) 100vw, 800px"
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
                          {cat}
                        </span>
                      ))
                    ) : (
                      <span className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full">
                        {artist.category}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className={`${isMinimal ? 'text-center' : ''}`}>
                  <h1 className={`${isMinimal ? 'heading-secondary' : 'heading-primary'} mb-4`}>
                    {artist.name}
                  </h1>
                  
                  <p className="text-body text-gray-600 mb-6">
                    {artist.oneLiner}
                  </p>
                  
                  {/* Contact */}
                  <div className="text-sm text-gray-500">
                    <p>
                      연락처: 
                      {!artist.contact || artist.contact === '' ? (
                        <span className="ml-1">비공개</span>
                      ) : artist.contact.includes('@') ? (
                        <a 
                          href={`mailto:${artist.contact}`}
                          className="hover:text-primary-600 transition-colors duration-200 underline underline-offset-4 hover:underline-offset-6 ml-1"
                        >
                          {artist.contact}
                        </a>
                      ) : artist.contact.match(/^[0-9\-\s\(\)]+$/) ? (
                        <a 
                          href={`tel:${artist.contact.replace(/[\s\-\(\)]/g, '')}`}
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
        <div className="container-custom">
          <div className="max-w-6xl mx-auto px-4">
            {/* 섹션 헤더 */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-3 mb-4">
                <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-primary-500"></div>
                <FiUser className="w-6 h-6 text-primary-600" />
                <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-primary-500"></div>
              </div>
              <h2 className="heading-secondary mb-3">
                {isMinimal ? '아티스트 소개' : '작업 세계'}
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                {artist.name}의 창작 철학과 예술적 여정을 만나보세요.
              </p>
            </div>

            {/* Bio 컨텐츠 */}
            <div className={`${isMinimal ? 'max-w-4xl mx-auto px-4' : 'grid lg:grid-cols-3 gap-8 lg:gap-12'}`}>
              {!isMinimal && (
                <div className="lg:col-span-1">
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
                    <div className="text-center">
                      <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-accent-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <div className="text-2xl">🎵</div>
                      </div>
                      <h3 className="heading-tertiary mb-2">창작자 정보</h3>
                      <p className="text-sm text-gray-600">
                        예술가의 배경과 경험을 통해 작품 세계를 이해해보세요.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className={`${isMinimal ? '' : 'lg:col-span-2'}`}>
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-4 sm:p-6 lg:p-8 shadow-lg border border-white/20">
                  <div className="prose prose-sm sm:prose-base lg:prose-lg max-w-none">
                    <ReactMarkdown
                      components={{
                        a: ({node, ...props}) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-700 underline underline-offset-4 hover:underline-offset-6"
                          />
                        )
                      }}
                    >{convertUrlsToMarkdownLinks(artist.bio)}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio Links */}
      {artist.portfolioLinks && artist.portfolioLinks.length > 0 && (
        <section className="py-12 sm:py-20">
          <div className="container-custom">
            <div className="max-w-6xl mx-auto px-4">
              {/* 섹션 헤더 */}
              <div className="text-center mb-12">
                <div className="inline-flex items-center gap-3 mb-4">
                  <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-accent-500"></div>
                  <FiLink className="w-6 h-6 text-accent-600" />
                  <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-accent-500"></div>
                </div>
                <h2 className="heading-secondary mb-3">
                  포트폴리오 & 소셜
                </h2>
                <p className="text-gray-600 max-w-2xl mx-auto">
                  {artist.name}의 다양한 플랫폼과 작품들을 더 자세히 만나보세요.
                </p>
              </div>

              {/* 포트폴리오 링크들 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 max-w-6xl mx-auto px-4 pb-4">
                {artist.portfolioLinks.map((link, index) => (
                  <a
                    key={index}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative overflow-hidden bg-white/70 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-lg border border-white/20 hover:shadow-2xl hover:scale-105 transition-all duration-300 min-w-0 break-words"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 mb-2 group-hover:text-accent-600 transition-colors duration-200 truncate">
                          {link.title}
                        </h3>
                        <p className="text-sm text-gray-600">
                          외부 플랫폼으로 이동
                        </p>
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
            <div className="container-custom">
              <div className="max-w-6xl mx-auto px-4">
                {/* 섹션 헤더 */}
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 mb-4">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-red-500"></div>
                    <FiPlay className="w-6 h-6 text-red-600" />
                    <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-red-500"></div>
                  </div>
                  <h2 className="heading-secondary mb-3">
                    영상으로 만나는 작품들
                  </h2>
                  <p className="text-gray-600 max-w-2xl mx-auto">
                    {artist.name}의 음악 세계를 직접 경험해보세요. 
                    각 영상은 아티스트의 고유한 감성과 창작 철학을 담고 있습니다.
                  </p>
                </div>

                {/* 비디오 그리드 */}
                <div className={`
                  grid gap-6 sm:gap-8 px-4 overflow-hidden
                  ${artist.youtubeVideos.length === 1 
                    ? 'grid-cols-1 max-w-3xl mx-auto' 
                    : artist.youtubeVideos.length === 2 
                    ? 'grid-cols-1 lg:grid-cols-2' 
                    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                  }
                `}>
                  {artist.youtubeVideos.map((video, index) => (
                    <div 
                      key={index}
                      className="transform transition-all duration-500 hover:-translate-y-2"
                      style={{
                        animationDelay: `${index * 200}ms`
                      }}
                    >
                      <YouTubeEmbed
                        videoUrl={video.url}
                        title={video.title}
                      />
                    </div>
                  ))}
                </div>

                {/* 더 많은 영상이 있을 경우의 안내 */}
                {artist.youtubeVideos.length > 0 && (
                  <div className="text-center mt-12">
                    <p className="text-gray-500 text-sm mb-4">
                      더 많은 영상은 아티스트의 개별 채널에서 확인하실 수 있습니다
                    </p>
                    {/* 포트폴리오 링크 중 YouTube가 있다면 버튼 표시 */}
                    {artist.portfolioLinks?.find(link => 
                      link.title.toLowerCase().includes('youtube') || 
                      link.url.includes('youtube.com')
                    ) && (
                      <a
                        href={artist.portfolioLinks.find(link => 
                          link.title.toLowerCase().includes('youtube') || 
                          link.url.includes('youtube.com')
                        )?.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors duration-200 font-medium"
                      >
                        <FiExternalLink className="w-4 h-4" />
                        YouTube 채널 방문하기
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
            <div className="container-custom">
              <div className="max-w-6xl mx-auto px-4">
                {/* 섹션 헤더 */}
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 mb-4">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-primary-500"></div>
                    <FiFolder className="w-6 h-6 text-primary-600" />
                    <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-primary-500"></div>
                  </div>
                  <h2 className="heading-secondary mb-3">
                    참여 프로젝트
                  </h2>
                  <p className="text-gray-600 max-w-2xl mx-auto">
                    {artist.name}이(가) 참여한 경기아트콜렉티브의 다양한 프로젝트들을 만나보세요.
                  </p>
                </div>

                {/* 프로젝트 목록 */}
                <ArtistProjects 
                  projects={artistProjects} 
                  artistName={artist.name}
                />
              </div>
            </div>
          </section>
        )}
  
        {/* Navigation */}
        <section className="pt-8 pb-12 sm:pb-20 mt-4">
          <div className="container-custom">
            <div className="text-center px-4">
              <div className="max-w-2xl mx-auto mb-8">
                <h3 className="heading-tertiary mb-3">
                  다른 아티스트들도 만나보세요
                </h3>
                <p className="text-gray-600">
                  경기아트콜렉티브와 함께하는 더 많은 예술가들의 세계를 탐험해보세요.
                </p>
              </div>
              <Link 
                href="/artists"
                className="btn-primary"
              >
                다른 아티스트 보기
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

export default ArtistDetailPage
