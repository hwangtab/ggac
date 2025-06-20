import Link from 'next/link'
import ImageWithFallback from './ImageWithFallback'

interface Artist {
  id: string
  slug: string
  name: string
  category: string | string[]
  profileImage: string
  oneLiner: string
}

interface FeaturedArtistsProps {
  artists: Artist[]
}

const FeaturedArtists = ({ artists }: FeaturedArtistsProps) => {
  console.log('FeaturedArtists artists:', artists)
  
  return (
    <section className="py-16 md:py-24">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="heading-secondary mb-4">함께하는 사람들</h2>
          <p className="text-body text-gray-600 max-w-2xl mx-auto">
            서로의 우주가 되어주는 예술가들을 만나보세요. 
            각자의 고유한 세계관과 창작 철학을 통해 새로운 가능성을 탐구합니다.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {artists.map((artist) => (
            <div key={artist.id} className="group">
              <Link href={`/artists/${artist.slug}`}>
                <div className="text-center">
                  {/* Artist Image */}
                  <div className="relative w-48 h-48 mx-auto mb-6 overflow-hidden rounded-full group-hover:scale-110 transition-transform duration-300">
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
                    
                    <h3 className="text-xl font-serif font-semibold mb-3 group-hover:text-primary-600 transition-colors duration-200">
                      {artist.name}
                    </h3>
                    
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {artist.oneLiner}
                    </p>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link 
            href="/artists"
            className="btn-secondary"
          >
            모든 아티스트 보기
          </Link>
        </div>
      </div>
    </section>
  )
}

export default FeaturedArtists
