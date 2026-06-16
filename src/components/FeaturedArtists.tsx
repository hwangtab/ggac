import { Link } from '@/i18n/navigation'
import OptimizedImage from './OptimizedImage'
import { getTranslations } from 'next-intl/server'
import { toSafeInternalImagePath } from '@/utils/safeUrl'
import type { FeaturedArtistsProps } from '@/types'

const FeaturedArtists = async ({ artists }: FeaturedArtistsProps) => {
  const t = await getTranslations('home')

  return (
    <section className="py-16 md:py-24">
      <div className="tw-container-custom">
        <div className="text-center mb-12">
          <h2 className="tw-heading-secondary mb-4">{t('artists.heading')}</h2>
          <p className="tw-text-body text-gray-600 max-w-2xl mx-auto">{t('artists.description')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {artists.map(artist => {
            const safeProfileImage = toSafeInternalImagePath(artist.profileImage)

            return (
              <div key={artist.id} className="group">
                <Link href={`/artists/${artist.slug}`}>
                  <div className="text-center">
                    {/* Artist Image */}
                    <div className="relative w-48 h-48 mx-auto mb-6 overflow-hidden rounded-full group-hover:scale-110 transition-transform duration-300">
                      <OptimizedImage
                        src={safeProfileImage}
                        alt={artist.name}
                        width={400}
                        height={400}
                        className="rounded-full object-cover w-full h-full"
                        fallbackText={artist.name.slice(0, 3)}
                        sizes="(max-width: 640px) 192px, 192px"
                      />
                    </div>

                    {/* Artist Info */}
                    <div>
                      <div className="mb-2 flex flex-wrap justify-center gap-1">
                        {Array.isArray(artist.category) ? (
                          <>
                            {artist.category.slice(0, 3).map(cat => (
                              <span
                                key={cat}
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
                                {t('artists.moreCount', { count: artist.category.length - 3 })}
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
            )
          })}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/artists"
            className="tw-btn-secondary text-lg px-8 py-4 sm:px-8 sm:py-3 rounded-lg w-full sm:w-auto text-center min-h-[44px] hover:-translate-y-0.5 hover:shadow-lg transition-all duration-300"
          >
            {t('artists.viewAll')}
          </Link>
        </div>
      </div>
    </section>
  )
}

export default FeaturedArtists
