'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Artist } from '@/types/artist'
import { toSafeArtistImageSrc } from '@/utils/safeUrl'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

interface Frame {
  slug: string
  name: string
  src: string
}

function toFrames(artists: Artist[]): Frame[] {
  return artists
    .filter(artist => artist?.slug && artist?.name)
    .map(artist => ({
      slug: artist.slug,
      name: artist.name,
      // profileImage는 내부 경로와 Supabase Storage URL이 섞여 있어 정규화가 필요하다.
      src: toSafeArtistImageSrc(artist.profileImage),
    }))
}

/**
 * 트랙 한 벌이 뷰포트를 덮도록 목록 반복 횟수를 정한다.
 *
 * 마퀴는 같은 벌 2개를 이어붙이고 `-50%`(= 한 벌 폭)까지 이동한다. 따라서
 * `한 벌 폭 < 뷰포트 폭`이면 사이클 끝에서 오른쪽에 빈 구간이 드러난다.
 * 목록이 13명으로 고정이고 카드 폭에 상한이 있어 한 벌 폭은 1,960px에서 멈추는데,
 * 1920·2560·3440 같은 화면에서는 그걸로 부족하다(실측 168~1,688px 구멍).
 * 그래서 폭을 재서 필요한 만큼만 반복한다 — 폰에서는 1회로 끝나 DOM이 늘지 않는다.
 */
function useMarqueeRepeats(
  viewportRef: React.RefObject<HTMLElement | null>,
  trackRef: React.RefObject<HTMLElement | null>,
  unitCount: number
): number {
  const [repeats, setRepeats] = useState(1)

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track || unitCount === 0) return

    const compute = () => {
      // 트랙 = 2벌 × repeats회 이므로 한 회분 폭은 이렇게 역산된다.
      const unitWidth = track.scrollWidth / (2 * repeats)
      if (!unitWidth) return
      const needed = Math.min(4, Math.max(1, Math.ceil(viewport.clientWidth / unitWidth)))
      if (needed !== repeats) setRepeats(needed)
    }

    compute()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(compute)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewportRef, trackRef, unitCount, repeats])

  return repeats
}

const PauseIcon = () => (
  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor" aria-hidden="true">
    <rect x="1" y="0.5" width="3" height="9" />
    <rect x="6" y="0.5" width="3" height="9" />
  </svg>
)

const PlayIcon = () => (
  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor" aria-hidden="true">
    <path d="M1 0.5 L9 5 L1 9.5 Z" />
  </svg>
)

interface HeroFilmstripProps {
  artists: Artist[]
}

/**
 * 히어로 하단 밴드 — 조합원 이름 티커(역방향)와 사진 필름스트립(정방향)이
 * 서로 반대로 흐른다. 두 마퀴 모두 같은 목록 2벌을 이어붙이고 -50%까지만
 * 이동하므로 이음매가 드러나지 않는다.
 *
 * 접근성 트리에는 첫 벌의 첫 회분만 노출한다. 나머지 반복분은 시각적 채움일 뿐이라
 * aria-hidden + tabIndex=-1로 제외해야 같은 링크가 여러 번 읽히지 않는다.
 */
const HeroFilmstrip = ({ artists }: HeroFilmstripProps) => {
  const t = useTranslations('home.hero')
  const prefersReducedMotion = usePrefersReducedMotion()
  const [paused, setPaused] = useState(false)

  const frames = useMemo(() => toFrames(artists), [artists])
  // 카운트 배지와 카드 수의 출처를 하나로 묶는다. 필터 조건이 다르면 "13명"이라
  // 말해놓고 카드는 12장인 상황이 생긴다.
  const names = useMemo(() => frames.map(frame => frame.name), [frames])

  const stripViewportRef = useRef<HTMLDivElement>(null)
  const stripTrackRef = useRef<HTMLUListElement>(null)
  const tickerViewportRef = useRef<HTMLDivElement>(null)
  const tickerTrackRef = useRef<HTMLDivElement>(null)

  const stripRepeats = useMarqueeRepeats(stripViewportRef, stripTrackRef, frames.length)
  const tickerRepeats = useMarqueeRepeats(tickerViewportRef, tickerTrackRef, names.length)

  /**
   * `overflow-x: hidden` 컨테이너도 프로그래밍적으로는 스크롤된다. Tab으로 화면 밖
   * 카드에 포커스가 가면 브라우저가 자동 스크롤해 scrollLeft가 밀리는데, 스크롤바가
   * 없어 되돌릴 방법이 없고 마퀴가 영구히 어긋난 채 돈다(실측 311px 빈 구간).
   * 포커스가 밴드를 떠날 때 원위치시켜 오염이 남지 않게 한다. 포커스가 머무는 동안은
   * 그대로 둬야 키보드 사용자가 자기가 고른 카드를 볼 수 있다.
   */
  const restoreScroll = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (prefersReducedMotion) return // 이때는 사용자가 직접 스크롤하는 게 정상 동작
      const viewport = event.currentTarget
      if (viewport.contains(event.relatedTarget as Node | null)) return
      viewport.scrollLeft = 0
    },
    [prefersReducedMotion]
  )

  if (frames.length === 0) return null

  const stripUnits = Array.from({ length: 2 * stripRepeats })
  const tickerUnits = Array.from({ length: 2 * tickerRepeats })

  return (
    <div data-paused={paused ? 'true' : undefined}>
      {/* 메타 행 — 라벨 + 인원 수 + 헤어라인 + 모션 정지 */}
      {/*
        기울인 밴드는 화면보다 6% 넓게 뽑혀 있다(.hero-band). 그만큼을 좌우 여백에
        더해주지 않으면 라벨과 헤어라인 끝이 화면 밖으로 잘려 나간다.
        티커와 필름스트립은 의도적으로 양옆으로 흘려보내므로 이 보정이 필요 없다.
      */}
      <div
        className="flex items-center gap-3 sm:gap-4"
        style={{ paddingInline: 'calc(6% + 1.25rem)' }}
      >
        <span className="text-[11px] uppercase tracking-[0.28em] text-white/65">
          {t('rosterLabel')}
        </span>
        <span className="text-[11px] tabular-nums text-white/60">
          {String(names.length).padStart(2, '0')}
        </span>
        <span className="h-px flex-1 bg-white/25" />
        {/*
          WCAG 2.2.2 — 5초를 넘는 자동 움직임에는 사용자가 발견해 호출할 수 있는
          정지 수단이 있어야 한다. hover/focus 부수효과는 메커니즘이 아니고,
          이름 티커에는 포커스 가능한 자손이 아예 없어 정지시킬 방법이 없었다.
        */}
        <button
          type="button"
          onClick={() => setPaused(previous => !previous)}
          aria-pressed={paused}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border border-white/35 text-white/75 transition-colors duration-200 hover:border-white/80 hover:text-white"
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          <span className="sr-only">{paused ? t('playMotion') : t('pauseMotion')}</span>
        </button>
      </div>

      {/* 이름 티커 — 저대비·역방향. 모션이라기보다 질감으로 읽히게 한다. */}
      <div
        ref={tickerViewportRef}
        className="hero-marquee-viewport mt-3 sm:mt-5"
        aria-hidden="true"
        // reduced-motion에서 스크롤 컨테이너가 되면 Chrome이 Tab 정지점으로 만든다.
        // aria-hidden 안의 보이지 않는 정지점이 생기므로 탭 순서에서 뺀다.
        tabIndex={-1}
      >
        <div
          ref={tickerTrackRef}
          className="hero-marquee text-[12px] uppercase tracking-[0.22em] text-white/55"
          style={
            {
              ['--marquee-duration' as string]: '48s',
              ['--marquee-direction' as string]: 'reverse',
            } as React.CSSProperties
          }
        >
          {tickerUnits.map((_, unit) => (
            <span key={unit} className="flex shrink-0 items-center">
              {names.map((name, index) => (
                <span key={`${name}-${index}`} className="flex items-center whitespace-nowrap">
                  <span>{name}</span>
                  <span className="mx-3 text-white/30 sm:mx-5">◆</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* 사진 필름스트립 */}
      <div
        ref={stripViewportRef}
        onBlur={restoreScroll}
        className="hero-marquee-viewport hero-marquee-viewport--scrollable mt-2 py-3 sm:mt-4"
      >
        {/*
          사진 스트립은 전체를 장식으로 둔다.

          밴드가 112% 폭에 margin-left:-6%라 첫 카드는 구조적으로 음수 x에 놓인다
          (1440px에서 x=-158..-26). 여기에 탭 포커스가 들어가면 포커스 링이 화면
          밖에 그려지는데, transform으로 밀린 요소라 브라우저가 스크롤해 보여줄
          방법도 없다(WCAG 2.4.7/2.4.11 위반).

          같은 13팀은 바로 아래 아티스트 인덱스에 이름·한 줄 소개·역할과 함께
          전부 링크로 노출된다. 스트립을 접근성 트리에서 빼도 잃는 정보가 없고,
          같은 링크가 두 번 읽히던 중복도 사라진다. 정지 버튼은 이 바깥에 있어
          WCAG 2.2.2 컨트롤은 그대로 유지된다.
        */}
        <ul
          ref={stripTrackRef}
          aria-hidden="true"
          className="hero-marquee items-start"
          style={{ ['--marquee-duration' as string]: '64s' } as React.CSSProperties}
        >
          {stripUnits.map((_, unit) =>
            frames.map((frame, index) => {
              return (
                <li key={`${unit}-${frame.slug}-${index}`} className="shrink-0 px-[3px] sm:px-1">
                  <Link
                    href={`/artists/${frame.slug}`}
                    tabIndex={-1}
                    className="hero-frame block"
                    // 카드도 화면 높이에 연동한다. 폭만 보면 낮은 창에서 스트립이 화면을 넘긴다.
                    style={{ width: 'clamp(66px, min(10.5vw, 16vh), 132px)' }}
                  >
                    <div
                      className="hero-frame-media relative w-full overflow-hidden border border-white/15 bg-white/[0.03]"
                      style={{ aspectRatio: '4 / 5', minHeight: '66px' }}
                    >
                      <Image
                        src={frame.src}
                        alt=""
                        fill
                        // 카드 폭이 반응형인데 고정 sizes를 쓰면 DPR3 폰에서 필요량의
                        // 3배짜리 소스를 받는다.
                        sizes="(max-width: 640px) 90px, 132px"
                        className="object-cover"
                        // priority 금지 — 13장에 우선순위를 주면 LCP 텍스트와 대역폭을 다툰다.
                      />
                    </div>
                    <span className="mt-2 block truncate text-[11px] uppercase tracking-[0.14em] text-white/75">
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
