import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import OptimizedImage from '@/components/OptimizedImage'
import TicketingCard from '@/components/TicketingCard'
import { convertUrlsToMarkdownLinks } from '@/utils/markdown'
import { TicketingInfo } from '@/utils/linkPreview'
import type { Metadata } from 'next'

interface Project {
  id: string
  slug: string
  title: string
  category: string
  publishedDate: string
  coverImage: string
  description: string
  gallery: string[]
  videoUrl: string | null
  artistIds: string[]
  ticketing?: TicketingInfo[]
}

interface Artist {
  id: string
  name: string
  slug: string
}

interface ProjectPageProps {
  params: {
    slug: string
  }
}

export async function generateStaticParams() {
  const projectsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
  ) as Project[]

  return projectsData.map((project) => ({
    slug: project.slug,
  }))
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const projectsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
  ) as Project[]

  const project = projectsData.find(p => p.slug === params.slug)

  if (!project) {
    return {
      title: 'Project Not Found | 경기아트콜렉티브 협동조합',
    }
  }

  // OG 이미지 결정 로직
  const getOgImage = () => {
    // 1. coverImage가 있으면 우선 사용
    if (project.coverImage) {
      return project.coverImage.replace('.webp', '.jpg')
    }
    
    // 2. 갤러리 첫 번째 이미지 사용
    if (project.gallery && project.gallery.length > 0) {
      return project.gallery[0].replace('.webp', '.jpg')
    }
    
    // 3. 기본 로고 이미지
    return '/images/logo/gac_og.webp'
  }

  const ogImageUrl = `https://ggac.kr${getOgImage()}`

  return {
    title: `${project.title} | 경기아트콜렉티브 협동조합`,
    description: project.description.split('\n')[0],
    openGraph: {
      title: project.title,
      description: project.description.split('\n')[0],
      url: `https://ggac.kr/archive/${project.slug}`,
      siteName: '경기아트콜렉티브 협동조합',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: project.title,
        }
      ],
      locale: 'ko_KR',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: project.title,
      description: project.description.split('\n')[0],
      images: [ogImageUrl],
    }
  }
}

const ProjectDetailPage = ({ params }: ProjectPageProps) => {
  const projectsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/projects.json'), 'utf8')
  ) as Project[]

  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  const project = projectsData.find(p => p.slug === params.slug)

  if (!project) {
    notFound()
  }

  const participatingArtists = project.artistIds
    .map(id => artistsData.find(artist => artist.id === id))
    .filter(Boolean) as Artist[]

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
                    <TicketingCard key={index} ticketing={ticket} />
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
                      className="aspect-square rounded-2xl overflow-hidden shadow-lg"
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

export default ProjectDetailPage
