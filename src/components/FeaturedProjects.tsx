import { Link } from '@/i18n/navigation'
import OptimizedImage from '@/components/OptimizedImage'
import { getTranslations, getLocale } from 'next-intl/server'
import { getProjectSummary } from '@/utils/projectUtils'
import type { FeaturedProjectsProps } from '@/types'

const FeaturedProjects = async ({ projects }: FeaturedProjectsProps) => {
  const t = await getTranslations('home')
  const locale = await getLocale()
  const dateLocale = locale === 'en' ? 'en-US' : 'ko-KR'

  return (
    <section className="py-16 md:py-24 bg-gray-50">
      <div className="tw-container-custom">
        <div className="text-center mb-12">
          <h2 className="tw-heading-secondary mb-4">{t('projects.heading')}</h2>
          <p className="tw-text-body text-gray-600 max-w-2xl mx-auto">
            {t('projects.description')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {projects.map((project, index) => (
            <div key={project.id} className={`group ${index === 0 ? 'md:col-span-2' : ''}`}>
              <Link href={`/archive/${project.slug}`}>
                <div
                  className={`relative overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 ${index === 0 ? '' : 'h-full'}`}
                >
                  {/* Project Image */}
                  <div
                    className={`relative ${index === 0 ? 'h-64 md:h-80' : 'h-64'} overflow-hidden`}
                  >
                    <OptimizedImage
                      src={project.coverImage}
                      alt={project.title}
                      width={800}
                      height={600}
                      className="object-cover w-full h-full"
                      priority={index === 0}
                      fallbackText={project.title.slice(0, 3)}
                      sizes={
                        index === 0
                          ? '(max-width: 768px) 100vw, (max-width: 1280px) 100vw, 1280px'
                          : '(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 640px'
                      }
                    />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
                  </div>

                  {/* Project Info */}
                  <div className={`p-6 pb-8 ${index === 0 ? '' : 'flex flex-col h-full'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full">
                        {project.category}
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(project.publishedDate).toLocaleDateString(dateLocale)}
                      </span>
                    </div>

                    <h3 className="text-2xl font-post font-semibold mb-3 text-gray-700 group-hover:text-primary-600 transition-colors duration-200">
                      {project.title}
                    </h3>

                    {(() => {
                      const limit = index === 0 ? 120 : 150
                      const summary = getProjectSummary(project, limit)
                      const truncated =
                        summary.length > limit ? `${summary.slice(0, limit)}...` : summary

                      return (
                        <p
                          className={`text-gray-600 ${index === 0 ? 'line-clamp-3' : 'line-clamp-4 flex-grow'}`}
                          title={summary}
                        >
                          {truncated}
                        </p>
                      )
                    })()}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/archive"
            className="tw-btn-primary text-lg px-8 py-4 sm:px-8 sm:py-3 rounded-lg w-full sm:w-auto text-center min-h-[44px] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300"
          >
            {t('projects.viewAll')}
          </Link>
        </div>
      </div>
    </section>
  )
}

export default FeaturedProjects
