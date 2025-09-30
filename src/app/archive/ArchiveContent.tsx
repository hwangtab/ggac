'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import OptimizedImage from '@/components/OptimizedImage'
import PaginationControls from '@/components/PaginationControls'
import { getProjectSummary } from '@/utils/projectUtils'
import { useFilter } from '@/hooks/useFilter'
import { usePagination } from '@/hooks/usePagination'
import { ARCHIVE_CATEGORIES } from '@/constants/categories'
import type { Project, Artist } from '@/types'

interface ArchiveContentProps {
  projects: Project[]
  artists: Artist[]
}

const ArchiveContent = ({ projects, artists }: ArchiveContentProps) => {
  const [selectedCategory, setSelectedCategory] = useState('All')
  const PROJECTS_PER_PAGE = 9 // 3x3 그리드

  const filteredProjects = useFilter(projects, selectedCategory, { allLabel: 'All' })

  // 페이지네이션 상태
  const [paginationState, paginationActions] = usePagination({
    initialPage: 1,
    pageSize: PROJECTS_PER_PAGE,
    totalCount: filteredProjects.length,
    basePath: '/archive',
  })

  // 현재 페이지에 표시할 프로젝트
  const startIndex = (paginationState.currentPage - 1) * PROJECTS_PER_PAGE
  const endIndex = startIndex + PROJECTS_PER_PAGE
  const paginatedProjects = filteredProjects.slice(startIndex, endIndex)

  // 카테고리 변경 시 1페이지로 리셋
  useEffect(() => {
    paginationActions.setTotalCount(filteredProjects.length)
    paginationActions.goToPage(1)
  }, [selectedCategory, filteredProjects.length])

  // Memoize artist name lookup to prevent O(n²) operations on every render
  const getArtistNames = useCallback(
    (artistIds: string[]) => {
      return artistIds
        .map(id => artists.find(artist => artist.id === id)?.name)
        .filter(Boolean)
        .join(', ')
    },
    [artists]
  )

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="container-custom text-center">
          <h1 className="heading-primary mb-6">
            우리가 만들어가는
            <br />
            프로젝트들
          </h1>
          <p className="text-body text-gray-600 max-w-3xl mx-auto">
            진행 중인 프로젝트부터 완성된 작품까지, 우리의 창작 여정을 함께 나누는 공간입니다.
            각각의 프로젝트에는 예술가들의 열정과 협동의 가치가 담겨 있습니다.
          </p>
        </div>
      </section>

      {/* Filter Section */}
      <section className="py-8 bg-white sticky top-16 z-40 border-b">
        <div className="container-custom">
          <div className="flex flex-wrap justify-center gap-2">
            {ARCHIVE_CATEGORIES.map(category => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                  selectedCategory === category
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Projects Grid */}
      <section className="py-16">
        <div className="container-custom">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {paginatedProjects.map((project, index) => (
              <div key={project.id} className="group opacity-100 transition-all duration-300">
                <Link href={`/archive/${project.slug}`}>
                  <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 overflow-hidden h-full flex flex-col">
                    {/* Project Image */}
                    <div className="relative h-48 overflow-hidden flex-shrink-0">
                      <OptimizedImage
                        src={project.coverImage}
                        alt={project.title}
                        width={400} // 모바일 최적화 (500 → 400)
                        height={280} // 비율 유지 (350 → 280)
                        className="object-cover w-full h-full"
                        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 400px"
                        priority={index < 3} // 첫 3개만 우선 로딩 (모바일 최적화)
                        quality={75} // 모바일 성능 향상을 위해 품질 조정
                      />
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
                    </div>

                    {/* Project Info */}
                    <div className="p-6 flex-grow flex flex-col">
                      <div className="flex items-center justify-between mb-3">
                        <span className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full">
                          {project.category}
                        </span>
                        <span className="text-sm text-gray-500">
                          {new Date(project.publishedDate).toLocaleDateString('ko-KR')}
                        </span>
                      </div>

                      <div className="min-h-[3.5rem] mb-2 flex items-start">
                        <h3 className="text-2xl font-post font-semibold text-gray-700 group-hover:text-primary-600 transition-colors duration-200 line-clamp-2">
                          {project.title}
                        </h3>
                      </div>

                      <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                        {getProjectSummary(project, 120)}
                      </p>

                      {project.artistIds.length > 0 && (
                        <p className="text-xs text-gray-500 mt-auto pt-2">
                          참여: {getArtistNames(project.artistIds)}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>

          {filteredProjects.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">해당 카테고리에 프로젝트가 없습니다.</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredProjects.length > 0 && (
          <PaginationControls
            currentPage={paginationState.currentPage}
            totalPages={paginationState.totalPages}
            totalCount={filteredProjects.length}
            pageSize={PROJECTS_PER_PAGE}
            onPageChange={paginationActions.goToPage}
            className="mt-12"
          />
        )}
      </section>
    </div>
  )
}

export default ArchiveContent
