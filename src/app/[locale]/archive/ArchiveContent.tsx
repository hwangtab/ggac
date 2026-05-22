import { Link } from '@/i18n/navigation'
import OptimizedImage from '@/components/OptimizedImage'
import { getProjectSummary } from '@/utils/projectUtils'
import { ARCHIVE_CATEGORIES, localizeArchiveCategory } from '@/constants/categories'
import { generatePageNumbers } from '@/utils/pagination'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Project } from '@/types'

interface ArchiveContentProps {
  projects: Project[]
  selectedCategory: string
  pagination: {
    currentPage: number
    totalPages: number
    totalCount: number
  }
  pageSize: number
  artistNameMap: Record<string, string>
}

const ARCHIVE_BASE_PATH = '/archive'

const buildArchiveHref = (page: number, category: string) => {
  const params = new URLSearchParams()

  if (page > 1) {
    params.set('page', page.toString())
  }

  if (category && category !== 'All') {
    params.set('category', category)
  }

  const query = params.toString()
  return query ? `${ARCHIVE_BASE_PATH}?${query}` : ARCHIVE_BASE_PATH
}

const ArchiveContent = async ({
  projects,
  selectedCategory,
  pagination,
  pageSize,
  artistNameMap,
}: ArchiveContentProps) => {
  const t = await getTranslations('archive')
  const locale = await getLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'
  const { currentPage, totalPages, totalCount } = pagination
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
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="tw-container-custom text-center">
          <h1 className="tw-heading-primary mb-6">
            {t('hero.titleLine1')}
            <br />
            {t('hero.titleLine2')}
          </h1>
          <p className="tw-text-body text-gray-600 max-w-3xl mx-auto">{t('hero.subtitle')}</p>
        </div>
      </section>

      <section className="py-8 bg-white sticky top-16 z-40 border-b">
        <div className="tw-container-custom">
          <div className="flex flex-wrap justify-center gap-2">
            {ARCHIVE_CATEGORIES.map(category => {
              const isActive = category === selectedCategory
              const href = buildArchiveHref(1, category)

              return (
                <Link
                  key={category}
                  href={href}
                  scroll={false}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {localizeArchiveCategory(category, locale)}
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
              {projects.map((project, index) => (
                <div key={project.id} className="group opacity-100 transition-all duration-300">
                  <Link href={`/archive/${project.slug}`}>
                    <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 overflow-hidden h-full flex flex-col">
                      <div className="relative h-48 overflow-hidden flex-shrink-0">
                        <OptimizedImage
                          src={project.coverImage}
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
                          <span className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full">
                            {localizeArchiveCategory(project.category, locale)}
                          </span>
                          <span className="text-sm text-gray-500">
                            {new Date(project.publishedDate).toLocaleDateString(dateLocale)}
                          </span>
                        </div>

                        <div className="h-16 mb-2 flex items-start">
                          <h3 className="text-2xl font-post font-semibold text-gray-700 group-hover:text-primary-600 transition-colors duration-200 line-clamp-2">
                            {project.title}
                          </h3>
                        </div>

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
              ))}
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
                      href={buildArchiveHref(currentPage - 1, selectedCategory)}
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
                          href={buildArchiveHref(page, selectedCategory)}
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
                      href={buildArchiveHref(currentPage + 1, selectedCategory)}
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

export default ArchiveContent
