'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import ImageWithFallback from '@/components/ImageWithFallback'

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

interface ArtistsContentProps {
  artists: Artist[]
}

const categories = ['All', '창작자', '기획자']

const ArtistsContent = ({ artists }: ArtistsContentProps) => {
  const [selectedCategory, setSelectedCategory] = useState('All')

  const filteredArtists = useMemo(() => {
    if (selectedCategory === 'All') return artists
    return artists.filter(artist => {
      if (Array.isArray(artist.category)) {
        return artist.category.includes(selectedCategory)
      }
      return artist.category === selectedCategory
    })
  }, [artists, selectedCategory])

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="container-custom text-center">
          <h1 className="heading-primary mb-6">
            서로의 우주가 되어
          </h1>
          <p className="text-body text-gray-600 max-w-3xl mx-auto">
            경기아트콜렉티브는 독립된 예술가들의 섬이 아닌, 서로가 서로에게 영감이 되고 지지가 되어주는 연결된 우주입니다. 
            이곳에서 각자의 빛으로 반짝이는 우리의 동료들을 만나보세요.
          </p>
        </div>
      </section>

      {/* Filter Section */}
      <section className="py-8 bg-white sticky top-16 z-40 border-b">
        <div className="container-custom">
          <div className="flex justify-center gap-2">
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

      {/* Artists Canvas */}
      <section className="py-16">
        <div className="container-custom">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-12">
            {filteredArtists.map((artist) => (
              <div key={artist.id} className="group">
                <Link href={`/artists/${artist.slug}`}>
                  <div className="text-center transform hover:scale-105 transition-transform duration-300">
                    {/* Artist Image */}
                    <div className="relative w-64 h-64 mx-auto mb-4 overflow-hidden rounded-full group-hover:scale-110 transition-transform duration-300">
                      <ImageWithFallback
                        src={artist.profileImage}
                        alt={artist.name}
                        width={400}
                        height={400}
                        fallbackText={artist.name.slice(0, 3)}
                        className="rounded-full"
                      />
                    </div>

                    {/* Artist Info */}
                    <div>
                      <div className="mb-2 flex flex-wrap justify-center gap-1">
                        {Array.isArray(artist.category) ? (
                          artist.category.map((cat, index) => (
                            <span 
                              key={index}
                              className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full"
                            >
                              {cat}
                            </span>
                          ))
                        ) : (
                          <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full">
                            {artist.category}
                          </span>
                        )}
                      </div>
                      
                      <h3 className="text-lg font-serif font-semibold mb-2 group-hover:text-primary-600 transition-colors duration-200">
                        {artist.name}
                      </h3>
                      
                      <p className="text-gray-600 text-sm leading-relaxed px-2">
                        {artist.oneLiner}
                      </p>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>

          {filteredArtists.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">
                해당 카테고리에 아티스트가 없습니다.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default ArtistsContent
