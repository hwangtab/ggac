'use client'

import Image from 'next/image'
import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Artist } from '@/types/artist'
import { toSafeArtistImageSrc } from '@/utils/safeUrl'

/**
 * 마퀴가 한 바퀴 도는 동안 빈 구간이 보이지 않으려면 트랙이 뷰포트보다 충분히 길어야
 * 한다. 조합원이 적을 때는 앞에서부터 반복해 이 칸 수를 채운다.
 */
const MIN_FRAMES = 12

interface Frame {
  slug: string
  name: string
  src: string
}

function toFrames(artists: Artist[]): Frame[] {
  const base = artists
    .filter(artist => artist?.slug && artist?.name)
    .map(artist => ({
      slug: artist.slug,
      name: artist.name,
      // profileImage는 내부 경로와 Supabase Storage URL이 섞여 있어 정규화가 필요하다.
      src: toSafeArtistImageSrc(artist.profileImage),
    }))

  if (base.length === 0) return []

  const frames = [...base]
  while (frames.length < MIN_FRAMES) {
    frames.push(base[frames.length % base.length])
  }
  // 홀수면 복제한 두 번째 벌의 짝/홀 어긋남으로 세로 오프셋 리듬이 깨진다.
  if (frames.length % 2 === 1) frames.push(base[0])

  return frames
}

const TickerRow = ({ names }: { names: string[] }) => (
  <span className="flex shrink-0 items-center">
    {names.map((name, index) => (
      <span key={`${name}-${index}`} className="flex items-center whitespace-nowrap">
        <span>{name}</span>
        <span className="mx-3 text-white/20 sm:mx-5">◆</span>
      </span>
    ))}
  </span>
)

interface HeroFilmstripProps {
  artists: Artist[]
}

/**
 * 히어로 하단 밴드 — 조합원 이름 티커(역방향)와 사진 필름스트립(정방향)이
 * 서로 반대로 흐른다. 두 마퀴 모두 같은 목록 2벌을 이어붙이고 -50%까지만
 * 이동하므로 이음매가 드러나지 않는다.
 */
const HeroFilmstrip = ({ artists }: HeroFilmstripProps) => {
  const t = useTranslations('home.hero')
  const frames = useMemo(() => toFrames(artists), [artists])
  const names = useMemo(
    () => artists.filter(artist => artist?.name).map(artist => artist.name),
    [artists]
  )

  if (frames.length === 0) return null

  return (
    <div>
      {/* 메타 행 — 라벨 + 인원 수 + 헤어라인 */}
      <div className="flex items-center gap-3 px-5 sm:gap-4 sm:px-8 lg:px-12">
        <span className="text-[10px] uppercase tracking-[0.28em] text-white/40 sm:text-[11px]">
          {t('rosterLabel')}
        </span>
        <span className="text-[10px] tabular-nums text-white/25 sm:text-[11px]">
          {String(names.length).padStart(2, '0')}
        </span>
        <span className="h-px flex-1 bg-white/15" />
      </div>

      {/* 이름 티커 — 저대비·역방향. 모션이라기보다 질감으로 읽히게 한다. */}
      <div className="hero-marquee-viewport mt-3 sm:mt-5" aria-hidden="true">
        <div
          className="hero-marquee text-[11px] uppercase tracking-[0.22em] text-white/35 sm:text-xs"
          style={
            {
              ['--marquee-duration' as string]: '48s',
              ['--marquee-direction' as string]: 'reverse',
            } as React.CSSProperties
          }
        >
          <TickerRow names={names} />
          <TickerRow names={names} />
        </div>
      </div>

      {/*
        사진 필름스트립.
        py-2.5는 장식이 아니라 필수다. overflow-x: hidden을 주면 세로축이 visible에서
        auto로 승격돼 패딩 박스 경계에서 잘리는데, 카드가 ±8px 어긋나 있어 여백이
        없으면 아래로 내려간 칸의 캡션이 잘려 나간다.
      */}
      <div className="hero-marquee-viewport mt-2 py-2.5 sm:mt-4">
        <ul
          className="hero-marquee items-start"
          style={{ ['--marquee-duration' as string]: '64s' } as React.CSSProperties}
          aria-label={t('rosterAria')}
        >
          {([0, 1] as const).map(copy =>
            frames.map((frame, index) => {
              const isClone = copy === 1
              return (
                <li
                  key={`${copy}-${frame.slug}-${index}`}
                  className="shrink-0 px-[3px] sm:px-1"
                  // 위아래로 나눠 어긋내 일직선 대신 리듬을 만든다. 한쪽으로만 밀면
                  // 아래로 내려간 칸의 캡션이 히어로 하단에서 잘린다.
                  style={{ transform: `translateY(${index % 2 === 1 ? 8 : -8}px)` }}
                  // 복제된 벌은 링크가 중복되므로 접근성 트리에서 제외한다.
                  aria-hidden={isClone || undefined}
                >
                  <Link
                    href={`/artists/${frame.slug}`}
                    tabIndex={isClone ? -1 : undefined}
                    className="hero-frame block outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    // 카드도 화면 높이에 연동한다. 폭만 보면 낮은 창에서 스트립이 화면을 넘긴다.
                    style={{ width: 'clamp(76px, min(10.5vw, 16vh), 132px)' }}
                  >
                    <div
                      className="relative w-full overflow-hidden border border-white/10 bg-white/[0.03]"
                      style={{ aspectRatio: '4 / 5' }}
                    >
                      <Image
                        src={frame.src}
                        alt=""
                        fill
                        sizes="132px"
                        className="object-cover"
                        // priority 금지 — 13장에 우선순위를 주면 LCP 텍스트와 대역폭을 다툰다.
                      />
                    </div>
                    <span className="mt-2 block truncate text-[10px] uppercase tracking-[0.14em] text-white/45 sm:text-[11px]">
                      {frame.name}
                    </span>
                  </Link>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}

export default HeroFilmstrip
