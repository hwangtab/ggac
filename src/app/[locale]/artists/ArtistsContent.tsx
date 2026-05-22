import { Link } from '@/i18n/navigation'
import OptimizedImage from '@/components/OptimizedImage'
import { getTranslations, getLocale } from 'next-intl/server'
import { localizeArtistCategory } from '@/constants/categories'
import type { Artist } from '@/types'

interface ArtistsContentProps {
  artists: Artist[]
  categories: string[]
  selectedCategory: string
}

const buildCategoryHref = (category: string) => {
  const params = new URLSearchParams()
  if (category !== 'All') {
    params.set('category', category)
  }
  const query = params.toString()
  return query ? `/artists?${query}` : '/artists'
}

const ArtistsContent = async ({ artists, categories, selectedCategory }: ArtistsContentProps) => {
  const t = await getTranslations('artists')
  const locale = await getLocale()
  const hasArtists = artists.length > 0

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-primary-50 to-accent-50">
        <div className="tw-container-custom text-center">
          <h1 className="tw-heading-primary mb-6">{t('hero.heading')}</h1>
          <p className="tw-text-body text-gray-600 max-w-3xl mx-auto">{t('hero.subtitle')}</p>
        </div>
      </section>

      {/* Filter Section */}
      <section className="py-8 bg-white sticky top-16 z-40 border-b">
        <div className="tw-container-custom">
          <div className="flex justify-center gap-2 flex-wrap">
            {categories.map(category => (
              <Link
                key={category}
                href={buildCategoryHref(category)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                  selectedCategory === category
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category === 'All' ? t('filter.all') : localizeArtistCategory(category, locale)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Artists Canvas */}
      <section className="py-16">
        <div className="tw-container-custom">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12">
            {artists.map((artist, index) => (
              <div key={artist.id} className="group">
                <Link href={`/artists/${artist.slug}`}>
                  <div className="text-center transform hover:scale-105 transition-transform duration-300">
                    {/* Artist Image */}
                    <div className="relative w-64 h-64 mx-auto mb-4 overflow-hidden rounded-full group-hover:scale-110 transition-transform duration-300">
                      <OptimizedImage
                        src={artist.profileImage}
                        alt={artist.name}
                        width={320}
                        height={320}
                        className="rounded-full object-cover w-full h-full"
                        sizes="(max-width: 640px) 320px, (max-width: 768px) 256px, 320px"
                        priority={index < 3} // 첫 3개 아티스트 이미지만 우선 로딩 (모바일 최적화)
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
                                {localizeArtistCategory(cat, locale)}
                              </span>
                            ))}
                            {artist.category.length > 3 && (
                              <span
                                className="inline-block px-3 py-1 bg-gray-200 text-gray-600 text-sm font-medium rounded-full cursor-help relative group/tooltip"
                                title={artist.category
                                  .slice(3)
                                  .map(c => localizeArtistCategory(c, locale))
                                  .join(', ')}
                              >
                                {t('moreCount', { count: artist.category.length - 3 })}
                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-normal max-w-sm leading-relaxed text-center z-50">
                                  {artist.category
                                    .slice(3)
                                    .map(c => localizeArtistCategory(c, locale))
                                    .join(', ')}
                                </div>
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full">
                            {localizeArtistCategory(artist.category as string, locale)}
                          </span>
                        )}
                      </div>

                      <h3 className="text-3xl font-post font-semibold mb-2 text-gray-700 group-hover:text-primary-600 transition-colors duration-200">
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

          {!hasArtists && (
            <div className="text-center py-16">
              <p className="text-gray-500 text-lg">{t('emptyState')}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default ArtistsContent
