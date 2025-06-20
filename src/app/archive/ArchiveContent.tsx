'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import SimpleImage from '@/components/SimpleImage'

interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  coverImage: string
  description: string
  artistIds: string[]
}

interface Artist {
  id: string
  name: string
}

interface ArchiveContentProps {
  projects: Project[]
  artists: Artist[]
}

const categories = [
  'All',
  '음반·음원',
  '공연·전시',
  '예술교육',
  '지원·용역사업',
  '행사'
]

const ArchiveContent = ({ projects, artists }: ArchiveContentProps) => {
  const [selectedCategory, setSelectedCategory] = useState('All')

  const filteredProjects = useMemo(() => {
    if (selectedCategory === 'All') return projects
    return projects.filter(project => project.category === selectedCategory)
  }, [projects, selectedCategory])

  const getArtistNames = (artistIds: string[]) => {
    return artistIds
      .map(id => artists.find(artist => artist.id === id)?.name)
      .filter(Boolean)
      .join(', ')
  }

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="container-custom text-center">
          <h1 className="heading-primary mb-6">
            우리가 만들어가는<br />
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
            {categories.map((category) => (
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
            {filteredProjects.map((project) => (
              <div 
                key={project.id}
                className="group opacity-100 transition-all duration-300"
              >
                <Link href={`/archive/${project.slug}`}>
                  <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 overflow-hidden h-full flex flex-col">
                    {/* Project Image */}
                    <div className="relative h-48 overflow-hidden flex-shrink-0">
                      <SimpleImage 
                        src={project.coverImage}
                        alt={project.title}
                        width={600}
                        height={400}
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
                      
                      <h3 className="text-lg font-serif font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-200">
                        {project.title}
                      </h3>
                      
                      <p className="text-gray-600 text-sm mb-3 line-clamp-3 flex-grow">
                        {project.description.split('\n')[0]}
                      </p>
                      
                      {project.artistIds.length > 0 && (
                        <p className="text-xs text-gray-500 mt-auto">
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
              <p className="text-gray-500 text-lg">
                해당 카테고리에 프로젝트가 없습니다.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default ArchiveContent
