import { memo } from 'react'
import Link from 'next/link'
import OptimizedImage from '@/components/OptimizedImage'
import type { Project, FeaturedProjectsProps } from '@/types'

const FeaturedProjects = ({ projects }: FeaturedProjectsProps) => {
  return (
    <section className="py-16 md:py-24 bg-gray-50">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="heading-secondary mb-4">최근 활동</h2>
          <p className="text-body text-gray-600 max-w-2xl mx-auto">
            우리의 가장 최근 작업들을 만나보세요. 각각의 프로젝트는 
            협동조합 구성원들의 창의적 실험과 협력의 결과입니다.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
          {projects.map((project, index) => (
            <div 
              key={project.id}
              className={`group ${index === 0 ? 'md:col-span-2' : ''}`}
            >
              <Link href={`/archive/${project.slug}`}>
                <div className={`relative overflow-hidden rounded-2xl bg-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 ${index === 0 ? '' : 'h-full'}`}>
                  {/* Project Image */}
                  <div className={`relative ${index === 0 ? 'h-64 md:h-80' : 'h-64'} overflow-hidden`}>
                    <OptimizedImage 
                      src={project.coverImage}
                      alt={project.title}
                      width={800}
                      height={600}
                      className="object-cover w-full h-full"
                      priority={index === 0} // 첫 번째 이미지만 우선 로딩
                      fallbackText={project.title.slice(0, 3)}
                    />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
                  </div>

                  {/* Project Info */}
                  <div className={`p-6 ${index === 0 ? '' : 'flex flex-col h-full'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full">
                        {project.category}
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(project.publishedDate).toLocaleDateString('ko-KR')}
                      </span>
                    </div>
                    
                    <h3 className="text-xl font-post font-semibold mb-3 group-hover:text-primary-600 transition-colors duration-200">
                      {project.title}
                    </h3>
                    
                    <p className={`text-gray-600 ${index === 0 ? 'line-clamp-3' : 'line-clamp-4 flex-grow'}`}>
                      {project.description.split('\n')[0]}
                    </p>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link 
            href="/archive"
            className="btn-primary text-lg px-8 py-4 sm:px-8 sm:py-3 rounded-lg w-full sm:w-auto text-center min-h-[44px] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300"
          >
            모든 프로젝트 보기
          </Link>
        </div>
      </div>
    </section>
  )
}

export default memo(FeaturedProjects)
