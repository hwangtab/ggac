import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { FiPlay, FiExternalLink, FiUser, FiLink } from 'react-icons/fi'
import ImageWithFallback from '@/components/ImageWithFallback'
import YouTubeEmbed from '@/components/YouTubeEmbed'
import type { Metadata } from 'next'

interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
  bio: string
  templateType: string
  portfolioLinks: Array<{ title: string; url: string }>
  youtubeVideos?: Array<{ title: string; url: string }>
  contact: string
}

interface ArtistPageProps {
  params: {
    slug: string
  }
}

export async function generateStaticParams() {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  return artistsData.map((artist) => ({
    slug: artist.slug,
  }))
}

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  const artist = artistsData.find(a => a.slug === params.slug)

  if (!artist) {
    return {
      title: 'Artist Not Found | 경기아트콜렉티브 협동조합',
    }
  }

  return {
    title: `${artist.name} | 경기아트콜렉티브 협동조합`,
    description: artist.oneLiner,
  }
}

const ArtistDetailPage = ({ params }: ArtistPageProps) => {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  const artist = artistsData.find(a => a.slug === params.slug)

  if (!artist) {
    notFound()
  }

  const isMinimal = artist.templateType === '미니멀형'

  return (
    <div className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
      {/* Header */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
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
              <div className={`${isMinimal ? 'mb-8' : ''}`}>
                <div className={`${isMinimal ? 'w-96 h-96 mx-auto' : 'w-96 h-96'} overflow-hidden rounded-full`}>
                  <ImageWithFallback
                    src={artist.profileImage}
                    alt={artist.name}
                    width={800}
                    height={800}
                    fallbackText={artist.name.slice(0, 3)}
                    className="rounded-full"
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
                          className="hover:text-primary-600 transition-colors duration-200 underline ml-1"
                        >
                          {artist.contact}
                        </a>
                      ) : artist.contact.match(/^[0-9\-\s\(\)]+$/) ? (
                        <a 
                          href={`tel:${artist.contact.replace(/[\s\-\(\)]/g, '')}`}
                          className="hover:text-primary-600 transition-colors duration-200 underline ml-1"
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
      <section className="py-20">
        <div className="container-custom">
          <div className="max-w-6xl mx-auto">
            {/* 섹션 헤더 */}
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-3 mb-4">
                <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-primary-500"></div>
                <FiUser className="w-6 h-6 text-primary-600" />
                <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-primary-500"></div>
              </div>
              <h2 className="text-2xl md:text-3xl font-serif font-semibold text-gray-900 mb-3">
                {isMinimal ? '아티스트 소개' : '작업 세계'}
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                {artist.name}의 창작 철학과 예술적 여정을 만나보세요.
              </p>
            </div>

            {/* Bio 컨텐츠 */}
            <div className={`${isMinimal ? 'max-w-4xl mx-auto' : 'grid lg:grid-cols-3 gap-12'}`}>
              {!isMinimal && (
                <div className="lg:col-span-1">
                  <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
                    <div className="text-center">
                      <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-accent-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <div className="text-2xl">🎵</div>
                      </div>
                      <h3 className="text-lg font-serif font-semibold text-gray-900 mb-2">창작자 정보</h3>
                      <p className="text-sm text-gray-600">
                        예술가의 배경과 경험을 통해 작품 세계를 이해해보세요.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className={`${isMinimal ? '' : 'lg:col-span-2'}`}>
                <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-8 shadow-lg border border-white/20">
                  <div className="prose prose-lg max-w-none">
                    <ReactMarkdown>{artist.bio}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio Links */}
      {artist.portfolioLinks && artist.portfolioLinks.length > 0 && (
        <section className="py-20">
          <div className="container-custom">
            <div className="max-w-6xl mx-auto">
              {/* 섹션 헤더 */}
              <div className="text-center mb-12">
                <div className="inline-flex items-center gap-3 mb-4">
                  <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-accent-500"></div>
                  <FiLink className="w-6 h-6 text-accent-600" />
                  <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-accent-500"></div>
                </div>
                <h2 className="text-2xl md:text-3xl font-serif font-semibold text-gray-900 mb-3">
                  포트폴리오 & 소셜
                </h2>
                <p className="text-gray-600 max-w-2xl mx-auto">
                  {artist.name}의 다양한 플랫폼과 작품들을 더 자세히 만나보세요.
                </p>
              </div>

              {/* 포트폴리오 링크들 */}
              <div className="flex flex-wrap justify-center gap-6 max-w-4xl mx-auto">
                {artist.portfolioLinks.map((link, index) => (
                  <a
                    key={index}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative overflow-hidden bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-2xl hover:scale-105 transition-all duration-300 w-full max-w-sm md:w-80"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 mb-2 group-hover:text-accent-600 transition-colors duration-200">
                          {link.title}
                        </h3>
                        <p className="text-sm text-gray-600">
                          외부 플랫폼으로 이동
                        </p>
                      </div>
                      <div className="w-12 h-12 bg-gradient-to-br from-accent-100 to-primary-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                        <FiExternalLink className="w-5 h-5 text-accent-600" />
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
          <section className="py-20">
            <div className="container-custom">
              <div className="max-w-6xl mx-auto">
                {/* 섹션 헤더 */}
                <div className="text-center mb-12">
                  <div className="inline-flex items-center gap-3 mb-4">
                    <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-red-500"></div>
                    <FiPlay className="w-6 h-6 text-red-600" />
                    <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-red-500"></div>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-serif font-semibold text-gray-900 mb-3">
                    영상으로 만나는 작품들
                  </h2>
                  <p className="text-gray-600 max-w-2xl mx-auto">
                    {artist.name}의 음악 세계를 직접 경험해보세요. 
                    각 영상은 아티스트의 고유한 감성과 창작 철학을 담고 있습니다.
                  </p>
                </div>

                {/* 비디오 그리드 */}
                <div className={`
                  grid gap-8 
                  ${artist.youtubeVideos.length === 1 
                    ? 'grid-cols-1 max-w-3xl mx-auto' 
                    : artist.youtubeVideos.length === 2 
                    ? 'grid-cols-1 lg:grid-cols-2' 
                    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
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
  
        {/* Navigation */}
        <section className="pt-8 pb-20 mt-4">
          <div className="container-custom">
            <div className="text-center">
              <div className="max-w-2xl mx-auto mb-8">
                <h3 className="text-xl font-serif font-semibold text-gray-900 mb-3">
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
  )
}

export default ArtistDetailPage
