'use client'

import { useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import OptimizedImage from '@/components/OptimizedImage'
import TicketingCard from '@/components/TicketingCard'
import Lightbox from '@/components/Lightbox'
import { convertUrlsToMarkdownLinks } from '@/utils/markdown'
import { TicketingInfo } from '@/utils/linkPreview'
import type { Project } from '@/lib/data'

interface Artist {
  id: string
  name: string
  slug: string
}

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
              >{convertUrlsToMarkdownLinks(project.description)}</ReactMarkdown>
            </div>

            {/* Video */}
            {project.videoUrl && (
              <div className="mt-12">
                <h3 className="text-xl font-serif font-semibold mb-6">관련 영상</h3>
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
                      <h3 className="text-xl font-serif font-semibold mb-6 text-gray-900" {...props} />
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
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {project.ticketing.map((ticket, index) => (
                    <TicketingCard key={index} ticketing={ticket as TicketingInfo} />
                  ))}
                </div>
              </div>
            )}

            {/* Gallery */}
            {project.gallery && project.gallery.length > 0 && (
              <div className="mt-12">
                <h3 className="text-xl font-serif font-semibold mb-6">갤러리</h3>
                <div className="grid md:grid-cols-2 gap-6">
                  {project.gallery.map((image, index) => (
                    <div 
                      key={index}
                      className="aspect-square rounded-2xl overflow-hidden shadow-lg cursor-pointer group relative"
                      onClick={() => openLightbox(index)}
                    >
                      <OptimizedImage 
                        src={image}
                        alt={`${project.title} - 이미지 ${index + 1}`}
                        width={600}
                        height={600}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        fallbackText={(index + 1).toString()}
                      />
                      {/* 호버 오버레이 */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
                          클릭하여 확대
                        </div>
                      </div>
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
              <h3 className="text-xl font-serif font-semibold text-gray-900 mb-3">
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
