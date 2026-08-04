import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { toSafeArtistImageSrc } from '@/utils/safeUrl'
import type { FeaturedArtistsProps } from '@/types'

/**
 * 공연 라인업 포스터 문법의 타이포 인덱스. 히어로 필름스트립이 이미 사진을
 * 보여주므로 여기서는 이름이 주인공이다. 한 줄 = 한 팀, 헤어라인으로 구분하고
 * hover 시 그 줄만 밝아지며 작은 사진이 오른쪽에 나타난다(데스크톱 한정).
 */
const FeaturedArtists = async ({ artists }: FeaturedArtistsProps) => {
  const t = await getTranslations('home')

  return (
    <section className="py-16 text-white md:py-24">
      <div className="tw-container-custom">
        {/* 킥커 행 */}
        <div className="flex items-center gap-3 sm:gap-4">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/65">
            {t('artists.heading')}
          </h2>
          <span className="text-[11px] tabular-nums text-white/60">
            {String(artists.length).padStart(2, '0')}
          </span>
          <span className="h-px flex-1 bg-white/25" />
          <Link
            href="/artists"
            className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/60 transition-colors duration-200 hover:text-white sm:inline-flex"
          >
            {t('artists.viewAll')}
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70 sm:text-base">
          {t('artists.description')}
        </p>

        <ul className="mt-10 border-t border-white/15">
          {artists.map(artist => {
            const safeProfileImage = toSafeArtistImageSrc(artist.profileImage)
            const roles = Array.isArray(artist.category)
              ? artist.category.join(' · ')
              : artist.category

            return (
              <li key={artist.id} className="border-b border-white/15">
                <Link
                  href={`/artists/${artist.slug}`}
                  className="group relative flex items-baseline gap-4 py-4 transition-colors duration-200 sm:gap-6 sm:py-5"
                >
                  <span
                    className="min-w-0 flex-1 truncate font-post font-bold leading-none text-white/75 transition-all duration-200 group-hover:translate-x-2 group-hover:text-white"
                    style={{ fontSize: 'clamp(1.5rem, 3.6vw, 3rem)', letterSpacing: '-0.03em' }}
                  >
                    {artist.name}
                  </span>
                  <span className="shrink-0 text-right text-[11px] uppercase tracking-[0.2em] text-white/60 transition-colors duration-200 group-hover:text-white/85 sm:text-xs">
                    {roles}
                  </span>
                  {/*
                    hover 사진 — 장식이므로 접근성 트리에서 제외. 이름 줄이 이미
                    링크 텍스트를 제공한다. transform/opacity만 애니메이션.
                  */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-[15%] top-1/2 z-10 hidden h-36 w-28 -translate-y-1/2 rotate-3 overflow-hidden border border-white/25 opacity-0 transition-opacity duration-300 group-hover:opacity-100 lg:block"
                  >
                    <Image
                      src={safeProfileImage}
                      alt=""
                      fill
                      sizes="112px"
                      className="object-cover"
                    />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>

        {/* 모바일용 전체 보기 — 데스크톱은 킥커 행의 링크가 담당 */}
        <div className="mt-10 sm:hidden">
          <Link
            href="/artists"
            className="inline-flex min-h-[48px] w-full items-center justify-center border border-white/50 px-8 text-sm font-semibold tracking-tight text-white transition-colors duration-300 hover:border-white hover:bg-white/10"
          >
            {t('artists.viewAll')}
          </Link>
        </div>
      </div>
    </section>
  )
}

export default FeaturedArtists
