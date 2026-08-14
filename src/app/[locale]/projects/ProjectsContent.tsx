'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import OptimizedImage from '@/components/OptimizedImage'
import { getProjectSummary } from '@/utils/projectUtils'
import { PROJECT_CATEGORIES, localizeProjectCategory } from '@/constants/categories'
import { generatePageNumbers } from '@/utils/pagination'
import { toSafeInternalImagePath } from '@/utils/safeUrl'
import { parseLocalDate } from '@/utils/date'
import { parseIntegerParam } from '@/utils/queryParams'
import { useTranslations, useLocale } from 'next-intl'
import type { ProjectCategory } from '@/constants/categories'
import type { Project } from '@/types'
import PageHero from '@/components/PageHero'

/** 2026-07-25 → 2026.07.25 — 홈 카드와 같은 포스터 날짜 스탬프 표기 */
function toStamp(value: string, locale: string): string {
  const date = parseLocalDate(value)
  if (Number.isNaN(date.getTime())) return value
  if (locale === 'en') {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

interface ProjectsContentProps {
  projects: Project[]
  /** 예정 공연(미래 eventDate·미취소, 서버에서 분리·정렬). 상단에 별도 노출. */
  upcomingProjects?: Project[]
  pageSize: number
  artistNameMap: Record<string, string>
}

const PROJECTS_BASE_PATH = '/projects'

const buildProjectsHref = (page: number, category: string) => {
  const params = new URLSearchParams()

  if (page > 1) {
    params.set('page', page.toString())
  }

  if (category && category !== 'All') {
    params.set('category', category)
  }

  const query = params.toString()
  return query ? `${PROJECTS_BASE_PATH}?${query}` : PROJECTS_BASE_PATH
}

// 카테고리(?category=)·페이지(?page=) 파생을 클라이언트에서 처리한다.
// 서버에서 searchParams를 읽으면 페이지가 동적 렌더링으로 전환되어 ISR이
// 사문화되므로(전수감사 P3) 서버는 전체 프로젝트를 정적으로 렌더한다.
//
// 프레젠테이션(ProjectsView)과 searchParams 브리지(기본 export)를 분리한 이유:
// useSearchParams 컴포넌트는 정적 프리렌더에서 Suspense 경계까지 CSR bailout
// 되어 초기 HTML에서 목록이 빠진다. page.tsx가 Suspense fallback으로 기본
// 상태(All·1페이지)의 ProjectsView를 렌더해 콘텐츠를 포함시킨다.
export const ProjectsView = ({
  projects,
  upcomingProjects = [],
  pageSize,
  artistNameMap,
  selectedCategory,
  requestedPage,
}: ProjectsContentProps & { selectedCategory: string; requestedPage: number }) => {
  const t = useTranslations('projects')
  const locale = useLocale()
  const isEn = locale === 'en'

  const filteredProjects = useMemo(() => {
    if (selectedCategory === 'All') return projects
    // 프로젝트 데이터의 category 값은 locale별 표기를 따르므로 동일 규칙으로 매칭
    const matchValue =
      locale === 'en'
        ? localizeProjectCategory(selectedCategory as ProjectCategory, 'en')
        : selectedCategory
    return projects.filter(project => project.category === matchValue)
  }, [projects, selectedCategory, locale])

  const totalCount = filteredProjects.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const paginatedProjects = filteredProjects.slice(startIndex, startIndex + pageSize)

  const isFirstPage = currentPage === 1
  const hasResults = totalCount > 0
  const startItem = hasResults ? (currentPage - 1) * pageSize + 1 : 0
  const endItem = hasResults ? Math.min(currentPage * pageSize, totalCount) : 0
  const pageNumbers = generatePageNumbers(currentPage, totalPages, 5)

  const getArtistNames = (artistIds: string[]) => {
    return artistIds
      .map(id => artistNameMap[id])
      .filter(Boolean)
      .join(', ')
  }

  return (
    <div className="pt-20">
      <PageHero
        kicker="PROJECTS"
        titleLine1={t('hero.titleLine1')}
        titleLine2={t('hero.titleLine2')}
        subtitle={t('hero.subtitle')}
      />

      {upcomingProjects.length > 0 && (
        <section className="border-b border-white/15 py-12">
          <div className="tw-container-custom">
            <h2 className="mb-6 text-[11px] uppercase tracking-[0.24em] text-white/70">
              {isEn ? 'Upcoming Shows' : '예정 공연'}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {upcomingProjects.map(project => (
                <Link
                  key={project.id}
                  href={`/projects/${project.slug}`}
                  className="group flex items-center gap-4 border border-white/15 bg-white/[0.03] p-4 transition-colors duration-200 hover:border-white/40"
                >
                  <div className="flex-shrink-0 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-400">
                      {isEn ? 'Upcoming' : '예정'}
                    </div>
                    <div className="mt-1 text-sm tabular-nums tracking-[0.08em] text-white/85">
                      {project.eventDate ? toStamp(project.eventDate, locale) : ''}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-post line-clamp-2 text-base font-bold leading-tight text-white">
                      {project.title}
                    </h3>
                    {project.venue?.name && (
                      <p className="mt-1 truncate text-xs text-white/55">{project.venue.name}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="sticky top-20 z-40 border-b border-white/15 bg-[#08080a]/95 py-6 backdrop-blur-sm">
        <div className="tw-container-custom">
          <div className="flex flex-wrap justify-center gap-2">
            {PROJECT_CATEGORIES.map(category => {
              const isActive = category === selectedCategory
              const href = buildProjectsHref(1, category)

              return (
                <Link
                  key={category}
                  href={href}
                  scroll={false}
                  className={`border px-4 py-2 text-[11px] uppercase tracking-[0.16em] transition-colors duration-200 ${
                    isActive
                      ? 'border-white text-white'
                      : 'border-white/20 text-white/55 hover:border-white/50 hover:text-white'
                  }`}
                >
                  {localizeProjectCategory(category, locale)}
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="tw-container-custom">
          {hasResults ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {paginatedProjects.map((project, index) => {
                const safeCoverImage = toSafeInternalImagePath(project.coverImage)

                return (
                  <div key={project.id} className="group opacity-100 transition-all duration-300">
                    <Link href={`/projects/${project.slug}`}>
                      <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 overflow-hidden h-full flex flex-col">
                        <div className="relative h-48 overflow-hidden flex-shrink-0">
                          <OptimizedImage
                            src={safeCoverImage}
                            alt={project.title}
                            width={400}
                            height={280}
                            className="object-cover w-full h-full"
                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 400px"
                            priority={isFirstPage && index < 3}
                            quality={75}
                          />
                          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
                        </div>

                        <div className="p-6 flex-grow flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            {/* 홈 카드와 같은 포스터 스탬프 표기 — 같은 아홉 건이
                                두 곳에서 다른 형식으로 나오던 불일치를 없앤다 */}
                            <span className="text-[11px] uppercase tracking-[0.2em] text-white/70">
                              [{localizeProjectCategory(project.category, locale)}]
                            </span>
                            <span className="text-[11px] tabular-nums tracking-[0.12em] text-white/60">
                              {toStamp(project.publishedDate, locale)}
                            </span>
                          </div>

                          <h2 className="font-post mb-2 line-clamp-2 text-2xl font-bold leading-tight text-white transition-colors duration-200">
                            {project.title}
                          </h2>

                          <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                            {getProjectSummary(project, 120)}
                          </p>

                          {project.artistIds.length > 0 && (
                            <p className="text-xs text-gray-500 mt-auto pt-2">
                              {t('participantsLabel')}: {getArtistNames(project.artistIds)}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">{t('emptyState')}</p>
            </div>
          )}

          <div className="mt-12 flex flex-col items-center space-y-4">
            <div className="text-sm text-gray-600">
              {t('pagination.total', { count: totalCount.toLocaleString() })}
              {hasResults && (
                <span className="ml-1">
                  {t('pagination.showing', {
                    start: startItem,
                    end: endItem,
                    current: currentPage,
                    total: totalPages,
                  })}
                </span>
              )}
            </div>

            {totalPages > 1 && (
              <nav aria-label={t('pagination.label')} role="navigation">
                <div className="flex items-center space-x-1">
                  {currentPage > 1 ? (
                    <Link
                      href={buildProjectsHref(currentPage - 1, selectedCategory)}
                      scroll={false}
                      className="px-3 py-2 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:text-primary-600 border border-gray-300 transition-colors duration-200"
                    >
                      <span className="hidden sm:inline">{t('pagination.prev')}</span>
                      <span className="sm:hidden">‹</span>
                    </Link>
                  ) : (
                    <span className="px-3 py-2 text-sm font-medium rounded-lg text-gray-400 bg-gray-100 cursor-not-allowed">
                      <span className="hidden sm:inline">{t('pagination.prev')}</span>
                      <span className="sm:hidden">‹</span>
                    </span>
                  )}

                  <div className="hidden sm:flex items-center space-x-1">
                    {pageNumbers.map((page, index) =>
                      page === '...' ? (
                        <span key={`ellipsis-${index}`} className="px-3 py-2 text-sm text-gray-400">
                          ...
                        </span>
                      ) : (
                        <Link
                          key={page}
                          href={buildProjectsHref(page, selectedCategory)}
                          scroll={false}
                          aria-current={page === currentPage ? 'page' : undefined}
                          className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors duration-200 ${
                            page === currentPage
                              ? 'bg-primary-600 text-white border-primary-600 cursor-default'
                              : 'text-gray-700 bg-white hover:bg-gray-50 hover:text-primary-600 border-gray-300'
                          }`}
                        >
                          {page}
                        </Link>
                      )
                    )}
                  </div>

                  <div className="sm:hidden flex items-center px-3 py-2 text-sm text-gray-600 bg-gray-50 rounded-lg">
                    {currentPage} / {totalPages}
                  </div>

                  {currentPage < totalPages ? (
                    <Link
                      href={buildProjectsHref(currentPage + 1, selectedCategory)}
                      scroll={false}
                      className="px-3 py-2 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:text-primary-600 border border-gray-300 transition-colors duration-200"
                    >
                      <span className="hidden sm:inline">{t('pagination.next')}</span>
                      <span className="sm:hidden">›</span>
                    </Link>
                  ) : (
                    <span className="px-3 py-2 text-sm font-medium rounded-lg text-gray-400 bg-gray-100 cursor-not-allowed">
                      <span className="hidden sm:inline">{t('pagination.next')}</span>
                      <span className="sm:hidden">›</span>
                    </span>
                  )}
                </div>
              </nav>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// searchParams 브리지 — URL 쿼리에서 카테고리·페이지를 파생해 뷰에 넘긴다.
const ProjectsContent = ({
  projects,
  upcomingProjects,
  pageSize,
  artistNameMap,
}: ProjectsContentProps) => {
  const searchParams = useSearchParams()
  const rawCategory = searchParams.get('category')
  const selectedCategory: string = PROJECT_CATEGORIES.includes(rawCategory as ProjectCategory)
    ? (rawCategory as ProjectCategory)
    : 'All'
  const requestedPage = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })

  return (
    <ProjectsView
      projects={projects}
      upcomingProjects={upcomingProjects}
      pageSize={pageSize}
      artistNameMap={artistNameMap}
      selectedCategory={selectedCategory}
      requestedPage={requestedPage}
    />
  )
}

export default ProjectsContent
