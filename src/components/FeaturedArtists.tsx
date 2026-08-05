import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import type { FeaturedArtistsProps } from '@/types'

/**
 * 공연 라인업 포스터 문법의 타이포 인덱스. 히어로 필름스트립이 이미 13팀 사진을
 * 보여주므로 여기서는 사진을 쓰지 않고 이름이 주인공이다.
 * 한 줄 = 한 팀: 번호 · 이름 · 한 줄 소개 · 역할. hover 시 그 줄 전체가 밝아진다.
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
          {artists.map((artist, index) => {
            // 역할이 10개까지 있는 조합원이 있어 그대로 두면 오른쪽 칸이 줄을
            // 잡아먹는다. 3개까지만 쓰고 나머지는 개수로 축약한다.
            const allRoles = Array.isArray(artist.category) ? artist.category : [artist.category]
            const roles =
              allRoles.slice(0, 3).join(' · ') +
              (allRoles.length > 3
                ? ` ${t('artists.moreCount', { count: allRoles.length - 3 })}`
                : '')

            return (
              <li key={artist.id} className="border-b border-white/15">
                {/*
                  컬럼 폭을 고정해 이름 길이와 무관하게 소개·역할이 같은 x에서
                  시작하도록 한다. 폭이 자동이면 줄마다 들쭉날쭉해 인덱스로 안 읽힌다.
                */}
                <Link
                  href={`/artists/${artist.slug}`}
                  className="group grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 py-4 sm:gap-x-6 sm:py-5 lg:grid-cols-[2.5rem_24rem_minmax(0,1fr)_auto] lg:gap-x-8 lg:gap-y-0"
                >
                  <span
                    aria-hidden="true"
                    className="tabular-nums text-[11px] text-white/55 transition-colors duration-200 group-hover:text-white/85 sm:text-xs"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="min-w-0 truncate font-post font-bold leading-none text-white/75 transition-all duration-200 group-hover:translate-x-2 group-hover:text-white"
                    style={{
                      fontSize: 'clamp(1.375rem, 2.9vw, 2.375rem)',
                      letterSpacing: '-0.03em',
                    }}
                  >
                    {artist.name}
                  </span>
                  {/*
                    한 줄 소개가 이름과 역할 사이의 빈 구간을 채운다. 아티스트
                    상세에만 있던 정보라 홈에서 얻는 정보량도 함께 늘어난다.
                  */}
                  <span className="hidden min-w-0 truncate text-sm text-white/55 transition-colors duration-200 group-hover:text-white/75 lg:block">
                    {artist.oneLiner}
                  </span>
                  <span className="col-start-2 truncate text-left text-[11px] uppercase tracking-[0.2em] text-white/60 transition-colors duration-200 group-hover:text-white/85 sm:text-xs lg:col-start-auto lg:whitespace-nowrap lg:text-right">
                    {roles}
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
