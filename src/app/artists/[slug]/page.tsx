import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import ImageWithFallback from '@/components/ImageWithFallback'
import type { Metadata } from 'next'

interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
  bio: string
  templateType: string
  portfolioLinks: Array<{ title: string; url: string }>
  contact: string
}

interface ArtistPageProps {
  params: {
    slug: string
  }
}

export async function generateStaticParams() {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  return artistsData.map((artist) => ({
    slug: artist.slug,
  }))
}

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  const artist = artistsData.find(a => a.slug === params.slug)

  if (!artist) {
    return {
      title: 'Artist Not Found | 경기아트콜렉티브 협동조합',
    }
  }

  return {
    title: `${artist.name} | 경기아트콜렉티브 협동조합`,
    description: artist.oneLiner,
  }
}

const ArtistDetailPage = ({ params }: ArtistPageProps) => {
  const artistsData = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/artists.json'), 'utf8')
  ) as Artist[]

  const artist = artistsData.find(a => a.slug === params.slug)

  if (!artist) {
    notFound()
  }

  const isMinimal = artist.templateType === '미니멀형'

  return (
    <div className="pt-20">
      {/* Header */}
      <section className={`py-16 md:py-24 ${isMinimal ? 'bg-white' : 'bg-gradient-to-br from-primary-50 to-accent-50'}`}>
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <Link 
                href="/artists" 
                className="inline-flex items-center text-primary-600 hover:text-primary-700 transition-colors duration-200"
              >
                ← 아티스트 목록으로 돌아가기
              </Link>
            </div>
            
            <div className={`${isMinimal ? 'text-center' : 'grid md:grid-cols-2 gap-12 items-center'}`}>
              {/* Profile Image */}
              <div className={`${isMinimal ? 'mb-8' : ''}`}>
                <div className={`${isMinimal ? 'w-96 h-96 mx-auto' : 'w-96 h-96'} overflow-hidden rounded-full`}>
                  <ImageWithFallback
                    src={artist.profileImage}
                    alt={artist.name}
                    width={800}
                    height={800}
                    fallbackText={artist.name.slice(0, 3)}
                    className="rounded-full"
                  />
                </div>
              </div>

              {/* Basic Info */}
              <div>
                {/* 카테고리 태그 */}
                <div className={`mb-4 ${isMinimal ? 'text-center' : 'category-tags-left'}`}>
                  <div className={`flex flex-wrap gap-2 ${isMinimal ? 'justify-center' : ''}`}>
                    {Array.isArray(artist.category) ? (
                      artist.category.map((cat, index) => (
                        <span 
                          key={index}
                          className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full"
                        >
                          {cat}
                        </span>
                      ))
                    ) : (
                      <span className="inline-block px-4 py-2 bg-primary-100 text-primary-700 font-medium rounded-full">
                        {artist.category}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className={`${isMinimal ? 'text-center' : ''}`}>
                  <h1 className={`${isMinimal ? 'heading-secondary' : 'heading-primary'} mb-4`}>
                    {artist.name}
                  </h1>
                  
                  <p className="text-body text-gray-600 mb-6">
                    {artist.oneLiner}
                  </p>
                  
                  {/* Contact */}
                  <div className="text-sm text-gray-500">
                    <p>
                      연락처: 
                      {!artist.contact || artist.contact === '' ? (
                        <span className="ml-1">비공개</span>
                      ) : artist.contact.includes('@') ? (
                        <a 
                          href={`mailto:${artist.contact}`}
                          className="hover:text-primary-600 transition-colors duration-200 underline ml-1"
                        >
                          {artist.contact}
                        </a>
                      ) : artist.contact.match(/^[0-9\-\s\(\)]+$/) ? (
                        <a 
                          href={`tel:${artist.contact.replace(/[\s\-\(\)]/g, '')}`}
                          className="hover:text-primary-600 transition-colors duration-200 underline ml-1"
                        >
                          {artist.contact}
                        </a>
                      ) : (
                        <span className="ml-1">{artist.contact}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bio Section */}
      <section className={`py-16 ${isMinimal ? 'bg-gray-50' : 'bg-white'}`}>
        <div className="container-custom">
          <div className="max-w-4xl mx-auto">
            <div className={`${isMinimal ? 'max-w-2xl mx-auto text-center' : 'grid md:grid-cols-3 gap-12'}`}>
              {!isMinimal && (
                <div>
                  <h2 className="text-xl font-serif font-semibold mb-6">작업 소개</h2>
                </div>
              )}
              
              <div className={`${isMinimal ? '' : 'md:col-span-2'}`}>
                <div className="prose prose-lg max-w-none">
                  <ReactMarkdown>{artist.bio}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio Links */}
      {artist.portfolioLinks && artist.portfolioLinks.length > 0 && (
        <section className={`py-16 ${isMinimal ? 'bg-white' : 'bg-gray-50'}`}>
          <div className="container-custom">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="text-xl font-serif font-semibold mb-8">포트폴리오</h2>
              <div className="flex flex-wrap justify-center gap-4">
                {artist.portfolioLinks.map((link, index) => (
                  <a
                    key={index}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                  >
                    {link.title}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Navigation */}
      <section className="py-16 bg-gray-900 text-white">
        <div className="container-custom">
          <div className="text-center">
            <Link 
              href="/artists"
              className="btn-primary bg-white text-gray-900 hover:bg-gray-100"
            >
              다른 아티스트 보기
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

export default ArtistDetailPage
