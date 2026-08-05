'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import OptimizedImage from '@/components/OptimizedImage'
import { useTranslations, useLocale } from 'next-intl'
import { localizeArtistCategory } from '@/constants/categories'
import { toSafeArtistImageSrc } from '@/utils/safeUrl'
import type { Artist } from '@/types'
import PageHero from '@/components/PageHero'

interface ArtistsContentProps {
  artists: Artist[]
  categories: string[]
}

const buildCategoryHref = (category: string) => {
  const params = new URLSearchParams()
  if (category !== 'All') {
    params.set('category', category)
  }
  const query = params.toString()
  return query ? `/artists?${query}` : '/artists'
}

// 카테고리 필터를 클라이언트(useSearchParams)에서 처리한다.
// 서버에서 searchParams를 읽으면 페이지 전체가 동적 렌더링으로 전환되어
// ISR(revalidate)이 사문화되므로(2026-07 전수감사 P3), 서버는 전체 아티스트를
// 정적으로 렌더하고 필터·선택 상태만 여기서 URL 쿼리로 파생한다.
//
// 프레젠테이션(ArtistsView)과 searchParams 브리지(기본 export)를 분리한 이유:
// useSearchParams 컴포넌트는 정적 프리렌더에서 Suspense 경계까지 CSR bailout
// 되어 초기 HTML에서 목록이 빠진다(SEO·첫 페인트 손실). page.tsx가 Suspense
// fallback으로 기본 상태(All)의 ArtistsView를 렌더해 콘텐츠를 포함시킨다.
export const ArtistsView = ({
  artists,
  categories,
  selectedCategory,
}: ArtistsContentProps & { selectedCategory: string }) => {
  const t = useTranslations('artists')
  const locale = useLocale()

  const filteredArtists = useMemo(
    () =>
      selectedCategory === 'All'
        ? artists
        : artists.filter(artist =>
            Array.isArray(artist.category)
              ? artist.category.includes(selectedCategory)
              : artist.category === selectedCategory
          ),
    [artists, selectedCategory]
  )

  const hasArtists = filteredArtists.length > 0

  return (
    <div className="pt-20">
      {/* Hero Section */}
      <PageHero kicker="ARTISTS" titleLine1={t('hero.heading')} subtitle={t('hero.subtitle')} />

      {/* Filter Section */}
      <section className="sticky top-20 z-40 border-b border-white/15 bg-[#08080a]/95 py-6 backdrop-blur-sm">
        <div className="tw-container-custom">
          <div className="flex justify-center gap-2 flex-wrap">
            {categories.map(category => (
              <Link
                key={category}
                href={buildCategoryHref(category)}
                scroll={false}
                className={`border px-4 py-2 text-[11px] uppercase tracking-[0.16em] transition-colors duration-200 ${
                  selectedCategory === category
                    ? 'border-white text-white'
                    : 'border-white/20 text-white/55 hover:border-white/50 hover:text-white'
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
            {filteredArtists.map((artist, index) => {
              const safeProfileImage = toSafeArtistImageSrc(artist.profileImage)

              return (
                <div key={artist.id} className="group">
                  <Link href={`/artists/${artist.slug}`}>
                    <div className="text-center transform hover:scale-105 transition-transform duration-300">
                      {/* Artist Image */}
                      <div className="relative w-64 h-64 mx-auto mb-4 overflow-hidden rounded-full group-hover:scale-110 transition-transform duration-300">
                        <OptimizedImage
                          src={safeProfileImage}
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

                        <h2 className="text-3xl font-post font-semibold mb-2 text-gray-700 group-hover:text-primary-600 transition-colors duration-200">
                          {artist.name}
                        </h2>

                        <p className="text-gray-600 text-sm leading-relaxed px-2">
                          {artist.oneLiner}
                        </p>
                      </div>
                    </div>
                  </Link>
                </div>
              )
            })}
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

// searchParams 브리지 — URL 쿼리에서 선택 카테고리를 파생해 뷰에 넘긴다.
const ArtistsContent = ({ artists, categories }: ArtistsContentProps) => {
  const searchParams = useSearchParams()
  const rawCategory = searchParams.get('category')
  const selectedCategory = rawCategory && categories.includes(rawCategory) ? rawCategory : 'All'

  return (
    <ArtistsView artists={artists} categories={categories} selectedCategory={selectedCategory} />
  )
}

export default ArtistsContent
