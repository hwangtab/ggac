'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import OptimizedImage from '@/components/OptimizedImage'
import TicketingCard from '@/components/TicketingCard'
import Lightbox from '@/components/Lightbox'
import { convertUrlsToMarkdownLinks } from '@/utils/markdown'
import { TicketingInfo } from '@/utils/linkPreview'

interface Artist {
  id: string; name: string; slug: string;
}

interface Project {
  id: string; slug: string; title: string; category: string; publishedDate: string;
  coverImage: string; description: string; gallery: string[]; videoUrl: string | null;
  artistIds: string[]; ticketing?: TicketingInfo[];
  participatingArtists: Artist[];
}

interface ProjectDetailContentProps {
  project: Project
}

const ProjectDetailContent = ({ project }: ProjectDetailContentProps) => {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  // 이미지 프리로딩
  useEffect(() => {
    if (project.gallery) {
      project.gallery.forEach(src => {
        const img = new Image()
        img.src = src
      })
    }
  }, [project.gallery])

  const openLightbox = (index: number) => {
    setSelectedImageIndex(index)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
  }

  const nextImage = () => {
    if (project.gallery) {
      setSelectedImageIndex((prevIndex) => (prevIndex + 1) % project.gallery.length)
    }
  }

  const prevImage = () => {
    if (project.gallery) {
      setSelectedImageIndex((prevIndex) => (prevIndex - 1 + project.gallery.length) % project.gallery.length)
    }
  }

  return (
    <>
      <div className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
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
              {project.participatingArtists.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2">
                  <span className="text-gray-600 mr-2">참여:</span>
                  {project.participatingArtists.map((artist, index) => (
                    <span key={artist.id}>
                      <Link 
                        href={`/artists/${artist.slug}`}
                        className="text-primary-600 hover:text-primary-700 font-medium"
                      >
                        {artist.name}
                      </Link>
                      {index < project.participatingArtists.length - 1 && ', '}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

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

        <section className="py-16">
          <div className="container-custom">
            <div className="max-w-4xl mx-auto">
              <div className="prose prose-lg max-w-none">
                <ReactMarkdown
                  components={{
                    a: ({node, ...props}) => (
                      <a {...props} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 underline" />
                    )
                  }}
                >{convertUrlsToMarkdownLinks(project.description)}</ReactMarkdown>
              </div>

              {project.ticketing && project.ticketing.length > 0 && (
                <div className="mt-12">
                  <h3 className="text-xl font-serif font-semibold mb-6 text-gray-900">예매하기</h3>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {project.ticketing.map((ticket, index) => (
                      <TicketingCard key={index} ticketing={ticket} />
                    ))}
                  </div>
                </div>
              )}

              {project.gallery && project.gallery.length > 0 && (
                <div className="mt-12">
                  <h3 className="text-xl font-serif font-semibold mb-6">갤러리</h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    {project.gallery.map((image, index) => (
                      <div 
                        key={index}
                        className="aspect-square rounded-2xl overflow-hidden shadow-lg cursor-pointer"
                        onClick={() => openLightbox(index)}
                      >
                        <OptimizedImage 
                          src={image}
                          alt={`${project.title} - 이미지 ${index + 1}`}
                          width={600}
                          height={600}
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                          fallbackText={(index + 1).toString()}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="pt-8 pb-20 mt-4">
          <div className="container-custom">
            <div className="text-center">
              <div className="max-w-2xl mx-auto mb-8">
                <h3 className="text-xl font-serif font-semibold text-gray-900 mb-3">다른 프로젝트들도 만나보세요</h3>
                <p className="text-gray-600">경기아트콜렉티브가 함께 만들어가는 더 많은 프로젝트들을 탐험해보세요.</p>
              </div>
              <Link href="/archive" className="btn-primary">다른 프로젝트 보기</Link>
            </div>
          </div>
        </section>
      </div>

      {lightboxOpen && project.gallery && (
        <Lightbox 
          images={project.gallery}
          currentIndex={selectedImageIndex}
          onClose={closeLightbox}
          onNext={nextImage}
          onPrev={prevImage}
        />
      )}
    </>
  )
}

export default ProjectDetailContent
