'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { localizeArchiveCategory } from '@/constants/categories'
import { Link } from '@/i18n/navigation'
import dynamic from 'next/dynamic'
import OptimizedImage from '@/components/OptimizedImage'
import YouTubeEmbed from '@/components/YouTubeEmbed'
import TicketingCard from '@/components/TicketingCard'
import ArticleCard from '@/components/ArticleCard'
import EventApplicationForm from '@/components/EventApplicationForm'

import { deriveProjectLead } from '@/utils/projectLead'
import { parseLocalDate } from '@/utils/date'
import { TicketingInfo } from '@/utils/linkPreview'
import { toSafeHttpUrl, toSafeInternalImagePath, toSafeLinkHref } from '@/utils/safeUrl'
import type { Project, Artist } from '@/types'
import { shiftMarkdownHeadings } from '@/utils/markdownHeadings'

// Lazy load heavy components
const ReactMarkdown = dynamic(() => import('react-markdown'), {
  loading: () => <div className="animate-pulse bg-gray-100 h-24 rounded-lg"></div>,
})

const Lightbox = dynamic(() => import('@/components/Lightbox'), {
  ssr: false,
})

interface ProjectDetailContentProps {
  project: Project
  participatingArtists: Artist[]
  relatedProjects: Array<
    Pick<Project, 'slug' | 'title' | 'coverImage' | 'publishedDate' | 'category'>
  >
  /** 예정 공연 여부(서버 판정). 상세 상단에 예정/지난 뱃지 표기. */
  isUpcoming?: boolean
}

export default function ProjectDetailContent({
  project,
  participatingArtists,
  relatedProjects,
  isUpcoming = false,
}: ProjectDetailContentProps) {
  const t = useTranslations('archive')
  const locale = useLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'
  const isEn = locale === 'en'
  // 공연일이 있으면 그 날짜를, 없으면 발행일을 상단에 표시.
  const displayDate = project.eventDate || project.publishedDate

  // 라이트박스 상태 관리
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // 갤러리 로딩 상태 관리
  const [galleryLoadingStates, setGalleryLoadingStates] = useState<{ [key: number]: boolean }>({})
  const [galleryErrorStates, setGalleryErrorStates] = useState<{ [key: number]: boolean }>({})
  const safeCoverImage = toSafeInternalImagePath(project.coverImage)
  const safeGalleryImages = project.gallery?.map(image => toSafeInternalImagePath(image)) ?? []
  const safeVideoUrl = project.videoUrl ? toSafeHttpUrl(project.videoUrl) : null
  const safeApplicationFormUrl =
    project.applicationForm && !project.applicationForm.internal
      ? toSafeHttpUrl(project.applicationForm.url)
      : null

  // 갤러리 전체 로딩 표시 제거
  // 개별 카드에서만 로딩 스켈레톤을 표시하여 무한 로딩 인상 방지

  const openLightbox = (index: number) => {
    setCurrentImageIndex(index)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
  }

  const nextImage = () => {
    if (safeGalleryImages.length > 0) {
      setCurrentImageIndex(prev => (prev === safeGalleryImages.length - 1 ? 0 : prev + 1))
    }
  }

  const prevImage = () => {
    if (safeGalleryImages.length > 0) {
      setCurrentImageIndex(prev => (prev === 0 ? safeGalleryImages.length - 1 : prev - 1))
    }
  }

  // 갤러리 이미지 로딩 상태 핸들러
  const handleImageLoad = (index: number) => {
    setGalleryLoadingStates(prev => ({
      ...prev,
      [index]: false, // 로딩 완료
    }))
  }

  const handleImageError = (index: number) => {
    setGalleryLoadingStates(prev => ({
      ...prev,
      [index]: false,
    }))
    setGalleryErrorStates(prev => ({
      ...prev,
      [index]: true,
    }))
  }

  // onLoadStart는 사용하지 않음: 뷰포트 밖 이미지까지 로딩 중으로 처리되어 전체 로딩이 지속되는 문제 방지

  return (
    <article className="pt-20 bg-gradient-to-b from-primary-50 via-accent-50 to-gray-200 min-h-screen">
      {/* Header */}
      <section className="py-16 md:py-24">
        <div className="tw-container-custom">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-6">
              <Link
                href="/archive"
                className="inline-flex items-center text-primary-600 hover:text-primary-700 transition-colors duration-200"
              >
                {t('detail.backLink')}
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              {project.eventDate &&
                (() => {
                  // 취소 > 예정 > 지난 순으로 판정(취소된 미래 공연이 '지난'으로 표시되던 오류 수정).
                  const [badgeClass, badgeLabel] = project.cancelled
                    ? ['bg-red-100 text-red-700', isEn ? 'Cancelled' : '취소']
                    : isUpcoming
                      ? ['bg-primary-600 text-white', isEn ? 'Upcoming' : '예정']
                      : ['bg-gray-200 text-gray-600', isEn ? 'Past' : '지난 공연']
                  return (
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${badgeClass}`}
                    >
                      {badgeLabel}
                    </span>
                  )
                })()}
              <span className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full">
                {localizeArchiveCategory(project.category, locale)}
              </span>
              <span className="text-gray-600">
                {parseLocalDate(displayDate).toLocaleDateString(dateLocale)}
              </span>
            </div>

            <h1 className="tw-heading-primary mb-6">{project.title}</h1>

            {participatingArtists.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                <span className="text-gray-600 mr-2">{t('detail.participantsLabel')}:</span>
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
        <div className="tw-container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="rounded-2xl overflow-hidden shadow-lg">
              <OptimizedImage
                src={safeCoverImage}
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
        <div className="tw-container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="prose prose-lg max-w-none">
              {/* 답변-우선 리드: 정의 문장→특징. 수동 리드가 없으면 필드에서 자동 생성. */}
              {(() => {
                const lead = project.lead || deriveProjectLead(project, locale, { isUpcoming })
                return lead ? (
                  <p className="!mt-0 mb-6 pb-6 border-b border-primary-100 text-gray-800 font-medium text-lg leading-relaxed">
                    {lead}
                  </p>
                ) : null
              })()}
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
                {shiftMarkdownHeadings(project.description)}
              </ReactMarkdown>
            </div>

            {/* Video */}
            {project.videoUrl && (
              <div className="mt-12">
                <h2 className="tw-heading-tertiary mb-6">{t('detail.videoHeading')}</h2>
                <YouTubeEmbed videoUrl={project.videoUrl} title={project.title} />
                {safeVideoUrl && (
                  <div className="mt-4 text-sm text-gray-500">
                    <a
                      href={safeVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-700 underline underline-offset-4 hover:underline-offset-6"
                    >
                      {t('detail.videoOpenLabel')}
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Application Form */}
            {project.applicationForm && (
              <div className="mt-12">
                <h2 className="tw-heading-tertiary mb-6">{t('detail.applicationHeading')}</h2>
                {project.applicationForm.internal ? (
                  <EventApplicationForm eventSlug={project.slug} />
                ) : safeApplicationFormUrl ? (
                  <a
                    href={safeApplicationFormUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block w-full md:w-auto px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl transition-colors duration-200 text-center shadow-lg hover:shadow-xl"
                  >
                    {project.applicationForm.title} →
                  </a>
                ) : (
                  <span className="inline-block w-full md:w-auto px-8 py-4 bg-gray-100 text-gray-500 font-semibold rounded-xl text-center">
                    {project.applicationForm.title}
                  </span>
                )}
              </div>
            )}

            {/* Ticketing */}
            {project.ticketing && project.ticketing.length > 0 && (
              <div className="mt-12">
                <h2 className="tw-heading-tertiary mb-6">{t('detail.ticketingHeading')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {project.ticketing.map((ticket, index) => (
                    <TicketingCard key={index} ticketing={ticket as TicketingInfo} />
                  ))}
                </div>
              </div>
            )}

            {/* Related Projects */}
            {relatedProjects.length > 0 && (
              <div className="mt-12">
                <h2 className="tw-heading-tertiary mb-6">{t('detail.relatedProjectsHeading')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {relatedProjects.map(relatedProject => {
                    const safeRelatedCoverImage = toSafeInternalImagePath(relatedProject.coverImage)

                    return (
                      <Link
                        key={relatedProject.slug}
                        href={`/archive/${relatedProject.slug}`}
                        className="group block border border-gray-200 rounded-2xl overflow-hidden bg-white hover:shadow-lg transition-shadow duration-200"
                      >
                        <div className="aspect-video overflow-hidden bg-gray-100">
                          <OptimizedImage
                            src={safeRelatedCoverImage}
                            alt={relatedProject.title}
                            width={640}
                            height={360}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            fallbackText={relatedProject.title.slice(0, 3)}
                          />
                        </div>
                        <div className="p-4">
                          <div className="text-sm text-primary-600 font-medium mb-2">
                            {localizeArchiveCategory(relatedProject.category, locale)}
                          </div>
                          <h3 className="font-semibold text-gray-900 line-clamp-2 mb-2">
                            {relatedProject.title}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {parseLocalDate(relatedProject.publishedDate).toLocaleDateString(
                              dateLocale
                            )}
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Related Articles */}
            {project.relatedArticles && project.relatedArticles.length > 0 && (
              <div className="mt-12">
                <h2 className="tw-heading-tertiary mb-6">{t('detail.relatedArticlesHeading')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {project.relatedArticles.map((article, index) => (
                    <ArticleCard key={index} article={article} />
                  ))}
                </div>
              </div>
            )}

            {/* Gallery */}
            {project.gallery && project.gallery.length > 0 && (
              <div className="mt-12">
                <h2 className="tw-heading-tertiary mb-6">{t('detail.galleryHeading')}</h2>

                {/* 갤러리 전체 로딩 표시는 제거하고, 각 카드 단위 스켈레톤만 유지 */}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {safeGalleryImages.map((safeGalleryImage, index) => (
                    <div
                      key={index}
                      className="aspect-square rounded-2xl overflow-hidden shadow-lg cursor-pointer group relative bg-gray-100"
                      onClick={() => galleryLoadingStates[index] === false && openLightbox(index)}
                      style={{ minHeight: '300px' }} // 레이아웃 안정성을 위한 최소 높이
                    >
                      {/* 개별 이미지 스켈레톤 - 한 번만 표시 */}
                      {galleryLoadingStates[index] !== false && (
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                          <div className="text-gray-400 text-lg font-medium">{index + 1}</div>
                        </div>
                      )}

                      <OptimizedImage
                        src={safeGalleryImage}
                        alt={t('detail.galleryImageAlt', {
                          title: project.title,
                          index: index + 1,
                        })}
                        width={500} // 더 작은 크기로 최적화 (600 → 500)
                        height={500}
                        className={`w-full h-full object-cover transition-all duration-300 ${
                          galleryLoadingStates[index] !== false
                            ? 'opacity-0'
                            : 'opacity-100 group-hover:scale-105'
                        }`}
                        fallbackText={(index + 1).toString()}
                        priority={index < 2} // 첫 2개 이미지만 우선 로딩
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 500px"
                        quality={85} // 약간 더 높은 품질로 최적화
                        onLoad={() => handleImageLoad(index)}
                        onError={() => handleImageError(index)}
                        suppressSkeleton={true} // 외부에서 스켈레톤 관리
                      />

                      {/* 호버 오버레이 - 로딩 완료 시에만 활성화 */}
                      {galleryLoadingStates[index] === false && !galleryErrorStates[index] && (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
                            {t('detail.galleryClickHint')}
                          </div>
                        </div>
                      )}

                      {/* 로딩 실패 시 재시도 버튼 */}
                      {galleryErrorStates[index] && (
                        <div className="absolute inset-0 bg-gray-50 flex items-center justify-center">
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              setGalleryErrorStates(prev => ({
                                ...prev,
                                [index]: false,
                              }))
                              setGalleryLoadingStates(prev => ({
                                ...prev,
                                [index]: true,
                              }))
                            }}
                            className="text-primary-600 hover:text-primary-700 text-sm underline underline-offset-4 hover:underline-offset-6"
                          >
                            {t('detail.galleryRetry')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lightbox */}
            {lightboxOpen && safeGalleryImages.length > 0 && (
              <Lightbox
                images={safeGalleryImages}
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
        <div className="tw-container-custom">
          <div className="text-center">
            <div className="max-w-2xl mx-auto mb-8">
              <h2 className="tw-heading-tertiary mb-3">{t('detail.navHeading')}</h2>
              <p className="text-gray-600">{t('detail.navBody')}</p>
            </div>
            <Link href="/archive" className="tw-btn-primary">
              {t('detail.navCta')}
            </Link>
          </div>
        </div>
      </section>
    </article>
  )
}
