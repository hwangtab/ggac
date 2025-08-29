'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import OptimizedImage from '@/components/OptimizedImage'
import TicketingCard from '@/components/TicketingCard'
import ArticleCard from '@/components/ArticleCard'

import { TicketingInfo } from '@/utils/linkPreview'
import type { Project, Artist } from '@/types'

// Lazy load heavy components
const ReactMarkdown = dynamic(() => import('react-markdown'), {
  loading: () => <div className="animate-pulse bg-gray-100 h-24 rounded-lg"></div>
})

const Lightbox = dynamic(() => import('@/components/Lightbox'), {
  ssr: false
})

interface ProjectDetailContentProps {
  project: Project
  participatingArtists: Artist[]
}

export default function ProjectDetailContent({ 
  project, 
  participatingArtists 
}: ProjectDetailContentProps) {
  // 라이트박스 상태 관리
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  
  // 갤러리 로딩 상태 관리
  const [galleryLoadingStates, setGalleryLoadingStates] = useState<{[key: number]: boolean}>({})
  const [galleryErrorStates, setGalleryErrorStates] = useState<{[key: number]: boolean}>({})
  
  // 갤러리 전체 로딩 완료 여부 계산
  const isGalleryLoading = project.gallery ? 
    Object.keys(galleryLoadingStates).length < project.gallery.length ||
    Object.values(galleryLoadingStates).some(loading => loading) : false

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
  }

  const nextImage = () => {
    if (project.gallery) {
      setCurrentImageIndex((prev) => 
        prev === project.gallery!.length - 1 ? 0 : prev + 1
      )
    }
  }

  const prevImage = () => {
    if (project.gallery) {
      setCurrentImageIndex((prev) => 
        prev === 0 ? project.gallery!.length - 1 : prev - 1
      )
    }
  }

  // 갤러리 이미지 로딩 상태 핸들러
  const handleImageLoad = (index: number) => {
    setGalleryLoadingStates(prev => ({
      ...prev,
      [index]: false
    }))
  }

  const handleImageError = (index: number) => {
    setGalleryLoadingStates(prev => ({
      ...prev,
      [index]: false
    }))
    setGalleryErrorStates(prev => ({
      ...prev,
      [index]: true
    }))
  }

  const handleImageStart = (index: number) => {
    setGalleryLoadingStates(prev => ({
      ...prev,
      [index]: true
    }))
  }

  return (
    <div className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
      {/* Header */}
      <section className="py-16 md:py-24">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-6">
              <Link 
                href="/archive" 
                className="inline-flex items-center text-primary-600 hover:text-primary-700 transition-colors duration-200"
              >
                ← 프로젝트로 돌아가기
              </Link>
            </div>
            
            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full">
                {project.category}
              </span>
              <span className="text-gray-600">
                {new Date(project.publishedDate).toLocaleDateString('ko-KR')}
              </span>
            </div>
            
            <h1 className="heading-primary mb-6">{project.title}</h1>
            
            {participatingArtists.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                <span className="text-gray-600 mr-2">참여:</span>
                {participatingArtists.map((artist, index) => (
                  <span key={artist.id}>
                    <Link 
                      href={`/artists/${artist.slug}`}
                      className="text-primary-600 hover:text-primary-700 font-medium"
                    >
                      {artist.name}
                    </Link>
                    {index < participatingArtists.length - 1 && ', '}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Image */}
      <section className="py-8">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="rounded-2xl overflow-hidden shadow-lg">
              <OptimizedImage 
                src={project.coverImage}
                alt={project.title}
                width={800}
                height={600}
                className="w-full h-auto object-cover"
                priority={true}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 800px"
                fallbackText={project.title.slice(0, 3)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="prose prose-lg max-w-none">
              <ReactMarkdown
                components={{
                  a: ({node, ...props}) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-700 underline"
                    />
                  )
                }}
              >{project.description}</ReactMarkdown>
            </div>

            {/* Video */}
            {project.videoUrl && (
              <div className="mt-12">
                <h3 className="heading-tertiary mb-6">관련 영상</h3>
                <div className="aspect-video bg-gray-100 rounded-2xl flex items-center justify-center">
                  <span className="text-gray-500">
                    Video: {project.videoUrl}
                  </span>
                </div>
              </div>
            )}

            {/* Ticketing */}
            {project.ticketing && project.ticketing.length > 0 && (
              <div className="mt-12">
                <ReactMarkdown
                  components={{
                    h3: ({ node, ...props }) => (
                      <h3 className="heading-tertiary mb-6" {...props} />
                    ),
                    a: ({node, ...props}) => (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 hover:text-primary-700 underline"
                      />
                    )
                  }}
                >
                  ### 예매하기
                </ReactMarkdown>
                <div className="grid md:grid-cols-2 gap-6">
                  {project.ticketing.map((ticket, index) => (
                    <TicketingCard key={index} ticketing={ticket as TicketingInfo} />
                  ))}
                </div>
              </div>
            )}

            {/* Related Articles */}
            {project.relatedArticles && project.relatedArticles.length > 0 && (
              <div className="mt-12">
                <h3 className="heading-tertiary mb-6">관련 기사</h3>
                <div className="grid md:grid-cols-2 gap-6">
                  {project.relatedArticles.map((article, index) => (
                    <ArticleCard key={index} article={article} />
                  ))}
                </div>
              </div>
            )}

            {/* Gallery */}
            {project.gallery && project.gallery.length > 0 && (
              <div className="mt-12">
                <h3 className="heading-tertiary mb-6">갤러리</h3>
                
                {/* 갤러리 전체 로딩 표시 */}
                {isGalleryLoading && (
                  <div className="mb-4 text-center">
                    <div className="inline-flex items-center gap-2 text-primary-600 text-sm">
                      <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
                      갤러리 로딩 중...
                    </div>
                  </div>
                )}
                
                <div className="grid md:grid-cols-2 gap-6">
                  {project.gallery.map((image, index) => (
                    <div 
                      key={index}
                      className="aspect-square rounded-2xl overflow-hidden shadow-lg cursor-pointer group relative bg-gray-100"
                      onClick={() => !galleryLoadingStates[index] && openLightbox(index)}
                      style={{ minHeight: '300px' }} // 레이아웃 안정성을 위한 최소 높이
                    >
                      {/* 개별 이미지 스켈레톤 - 한 번만 표시 */}
                      {galleryLoadingStates[index] && (
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                          <div className="text-gray-400 text-lg font-medium">
                            {index + 1}
                          </div>
                        </div>
                      )}
                      
                      <OptimizedImage 
                        src={image}
                        alt={`${project.title} - 이미지 ${index + 1}`}
                        width={500} // 더 작은 크기로 최적화 (600 → 500)
                        height={500}
                        className={`w-full h-full object-cover transition-all duration-300 ${
                          galleryLoadingStates[index] ? 'opacity-0' : 'opacity-100 group-hover:scale-105'
                        }`}
                        fallbackText={(index + 1).toString()}
                        priority={index < 2} // 첫 2개 이미지만 우선 로딩
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 500px"
                        quality={85} // 약간 더 높은 품질로 최적화
                        onLoadStart={() => handleImageStart(index)}
                        onLoad={() => handleImageLoad(index)}
                        onError={() => handleImageError(index)}
                        suppressSkeleton={true} // 외부에서 스켈레톤 관리
                      />
                      
                      {/* 호버 오버레이 - 로딩 완료 시에만 활성화 */}
                      {!galleryLoadingStates[index] && !galleryErrorStates[index] && (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
                            클릭하여 확대
                          </div>
                        </div>
                      )}
                      
                      {/* 로딩 실패 시 재시도 버튼 */}
                      {galleryErrorStates[index] && (
                        <div className="absolute inset-0 bg-gray-50 flex items-center justify-center">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation()
                              setGalleryErrorStates(prev => ({
                                ...prev,
                                [index]: false
                              }))
                              handleImageStart(index)
                            }}
                            className="text-primary-600 hover:text-primary-700 text-sm underline"
                          >
                            다시 시도
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lightbox */}
            {lightboxOpen && project.gallery && (
              <Lightbox
                images={project.gallery}
                currentIndex={currentImageIndex}
                onClose={closeLightbox}
                onNext={nextImage}
                onPrev={prevImage}
              />
            )}
          </div>
        </div>
      </section>

      {/* Navigation */}
      <section className="pt-8 pb-20 mt-4">
        <div className="container-custom">
          <div className="text-center">
            <div className="max-w-2xl mx-auto mb-8">
              <h3 className="heading-tertiary mb-3">
                다른 프로젝트들도 만나보세요
              </h3>
              <p className="text-gray-600">
                경기아트콜렉티브가 함께 만들어가는 더 많은 프로젝트들을 탐험해보세요.
              </p>
            </div>
            <Link 
              href="/archive"
              className="btn-primary"
            >
              다른 프로젝트 보기
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
