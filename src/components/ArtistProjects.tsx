'use client'

import Link from 'next/link'
import OptimizedImage from '@/components/OptimizedImage'
import { FiCalendar, FiTag, FiExternalLink } from 'react-icons/fi'
import { getProjectSummary } from '@/utils/projectUtils'
import { useTranslations, useLocale } from 'next-intl'
import { localizeArchiveCategory } from '@/constants/categories'
import type { Project } from '@/types'

interface ArtistProjectsProps {
  projects: Project[]
  artistName?: string
  className?: string
}

export default function ArtistProjects({
  projects,
  artistName,
  className = '',
}: ArtistProjectsProps) {
  const t = useTranslations('artists')
  const locale = useLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'

  if (projects.length === 0) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <div className="max-w-md mx-auto">
          <div className="w-24 h-24 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
            <div className="text-3xl text-gray-400">🎭</div>
          </div>
          <h3 className="text-xl font-serif font-semibold text-gray-700 mb-2">
            {t('artistProjects.empty')}
          </h3>
          <p className="text-gray-500 text-sm">
            {artistName
              ? t('artistProjects.comingSoonNamed', { name: artistName })
              : t('artistProjects.comingSoon')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${className}`}>
      {/* 프로젝트 그리드 */}
      <div
        className={`
        grid gap-6 
        ${
          projects.length === 1
            ? 'grid-cols-1 max-w-md mx-auto'
            : projects.length === 2
              ? 'grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto'
              : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
        }
      `}
      >
        {projects.map((project, index) => (
          <Link key={project.id} href={`/archive/${project.slug}`} className="group block">
            <article
              className="bg-white/70 backdrop-blur-sm rounded-2xl overflow-hidden shadow-lg border border-white/20 hover:shadow-2xl hover:scale-105 transition-all duration-300 h-full flex flex-col"
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              {/* 프로젝트 이미지 */}
              <div className="relative aspect-[16/10] overflow-hidden">
                <OptimizedImage
                  src={project.coverImage}
                  alt={project.title}
                  width={600}
                  height={375}
                  className="object-cover w-full h-full group-hover:scale-110 transition-transform duration-500"
                  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  priority={index === 0} // 첫 번째 프로젝트 이미지만 우선 로딩
                />

                {/* 카테고리 배지 */}
                <div className="absolute top-4 left-4">
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary-600/90 text-white text-xs font-medium rounded-full backdrop-blur-sm">
                    <FiTag className="w-3 h-3" />
                    {localizeArchiveCategory(project.category, locale)}
                  </span>
                </div>

                {/* 호버 오버레이 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* 외부링크 아이콘 */}
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                    <FiExternalLink className="w-4 h-4 text-white" />
                  </div>
                </div>
              </div>

              {/* 프로젝트 정보 */}
              <div className="p-6 flex-grow flex flex-col">
                {/* 날짜 */}
                <div className="flex items-center gap-1 text-gray-500 text-sm mb-3">
                  <FiCalendar className="w-4 h-4" />
                  {new Date(project.publishedDate).toLocaleDateString(dateLocale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>

                {/* 제목 */}
                <h3 className="font-serif font-semibold text-primary-700 text-2xl mb-3 group-hover:text-primary-600 transition-colors duration-200 line-clamp-2">
                  {project.title}
                </h3>

                {/* 설명 */}
                <p className="text-gray-600 text-sm line-clamp-3 leading-relaxed flex-grow">
                  {getProjectSummary(project, 100)}
                </p>

                {/* 더보기 표시 */}
                <div className="mt-auto flex items-center text-primary-600 text-sm font-medium group-hover:text-primary-700 transition-colors duration-200">
                  {t('artistProjects.viewDetail')}
                  <FiExternalLink className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform duration-200" />
                </div>
              </div>

              {/* 호버 그라데이션 효과 */}
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500/0 via-primary-500/5 to-accent-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl pointer-events-none" />
            </article>
          </Link>
        ))}
      </div>

      {/* 프로젝트 수 정보 */}
      {projects.length > 0 && (
        <div className="text-center mt-8">
          <p className="text-gray-500 text-sm">
            {t('artistProjects.totalCount', { count: projects.length })}
          </p>
        </div>
      )}
    </div>
  )
}
