import { memo } from 'react'
import Link from 'next/link'
import OptimizedImage from './OptimizedImage'
import type { Artist, FeaturedArtistsProps } from '@/types'

const FeaturedArtists = ({ artists }: FeaturedArtistsProps) => {
  return (
    <section className="py-16 md:py-24">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="heading-secondary mb-4">함께하는 사람들</h2>
          <p className="text-body text-gray-600 max-w-2xl mx-auto">
            서로의 우주가 되어주는 예술가들을 만나보세요. 각자의 고유한 세계관과 창작 철학을 통해
            새로운 가능성을 탐구합니다.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {artists.map(artist => (
            <div key={artist.id} className="group">
              <Link href={`/artists/${artist.slug}`}>
                <div className="text-center">
                  {/* Artist Image */}
                  <div className="relative w-48 h-48 mx-auto mb-6 overflow-hidden rounded-full group-hover:scale-110 transition-transform duration-300">
                    <OptimizedImage
                      src={artist.profileImage}
                      alt={artist.name}
                      width={400}
                      height={400}
                      className="rounded-full object-cover w-full h-full"
                      fallbackText={artist.name.slice(0, 3)}
                    />
                  </div>

                  {/* Artist Info */}
                  <div>
                    <div className="mb-2 flex flex-wrap justify-center gap-1">
                      {Array.isArray(artist.category) ? (
                        <>
                          {artist.category.slice(0, 3).map((cat, index) => (
                            <span
                              key={index}
                              className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full"
                            >
                              {cat}
                            </span>
                          ))}
                          {artist.category.length > 3 && (
                            <span
                              className="inline-block px-3 py-1 bg-gray-200 text-gray-600 text-sm font-medium rounded-full cursor-help relative group/tooltip"
                              title={artist.category.slice(3).join(', ')}
                            >
                              +{artist.category.length - 3}개
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-normal max-w-sm leading-relaxed text-center z-50">
                                {artist.category.slice(3).join(', ')}
                              </div>
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full">
                          {artist.category}
                        </span>
                      )}
                    </div>

                    <h3 className="text-2xl font-post font-semibold mb-3 text-gray-700 group-hover:text-primary-600 transition-colors duration-200">
                      {artist.name}
                    </h3>

                    <p className="text-gray-600 text-sm leading-relaxed">{artist.oneLiner}</p>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/artists"
            className="btn-secondary text-lg px-8 py-4 sm:px-8 sm:py-3 rounded-lg w-full sm:w-auto text-center min-h-[44px] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300"
          >
            모든 아티스트 보기
          </Link>
        </div>
      </div>
    </section>
  )
}

export default memo(FeaturedArtists)
