'use client'

import { useEffect, useRef, memo } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import HeroFilmstrip from './HeroFilmstrip'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { usePointerParallax } from '@/hooks/usePointerParallax'
import { useOffscreenPause } from '@/hooks/useOffscreenPause'
import { useFrameBudget } from '@/hooks/useFrameBudget'
import { getErrorTracker } from '@/utils/errorTracking'
import type { Artist } from '@/types/artist'

interface HeroProps {
  artists: Artist[]
}

/**
 * 개발 전용 오버레이. 정적 import로 두면 런타임에 렌더되지 않아도 코드가
 * 프로덕션 청크에 실린다. NODE_ENV 분기는 빌드 시 상수로 접혀 dead code가 된다.
 */
const PerformanceMonitor =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('./PerformanceMonitor'), { ssr: false })
    : null

/**
 * grid-cols-1(= minmax(0, 1fr))이 필수다. 기본 auto 열은 max-content로 부풀기 때문에
 * 하단 마퀴 트랙(수천 px)이 열 너비를 결정해버리고, 그러면 타이포 블록이 화면 밖으로
 * 밀려난다. 트랙을 감싼 overflow-hidden은 내재 크기 기여를 줄여주지 않는다.
 */
const SECTION_CLASS =
  'relative grid min-h-[100svh] grid-cols-1 grid-rows-[1fr_auto] overflow-hidden bg-[#08080a] text-white'

/**
 * 공연 포스터 문법의 풀블리드 히어로.
 *
 * 모션 규칙 두 가지를 지킨다.
 * 1. **히어로 안의 모든 진입 애니메이션은 transform 전용이다.** opacity로 시작하면
 *    그 요소가 LCP로 뽑히는 순간 LCP가 애니메이션 길이만큼 밀린다. 어떤 요소가
 *    LCP가 될지는 뷰포트 폭에 따라 바뀌므로(폰에서는 h1이 아니라 부제가 가장 크다)
 *    "이 요소는 LCP가 아닐 것"이라는 가정을 아예 두지 않는다.
 * 2. 포인터에 반응하는 것은 빛뿐이다. 콘텐츠(제목·CTA·카드)는 마우스를 따라
 *    움직이지 않는다.
 *
 * reduced-motion 대응은 전부 globals.css의 미디어 쿼리 가드가 담당한다.
 * 클래스를 조건부로 붙이지 않으므로 하이드레이션 불일치가 생기지 않는다.
 */
const Hero = ({ artists }: HeroProps) => {
  const t = useTranslations('home.hero')
  const tc = useTranslations('common')
  const prefersReducedMotion = usePrefersReducedMotion()
  const sectionRef = useRef<HTMLElement>(null)

  // --mx/--my는 섹션 요소에만 쓴다. documentElement에 쓰면 상속형 커스텀
  // 프로퍼티라 문서 전체 스타일 재계산을 유발한다(실측 215배 비쌈).
  /*
    GPU 합성이 꺼진 브라우저에서는 전체화면 장식의 합성이 CPU로 내려와 프레임이
    무너진다(실측 QHD 18.8fps). 사양으로는 판별되지 않으므로 실제 프레임을 재고,
    못 따라오면 전체화면 애니메이션만 멈춘다 — 그림은 그대로 남고 57.5fps로 회복된다.
  */
  const frameStarved = useFrameBudget({ disabled: prefersReducedMotion })

  usePointerParallax(sectionRef, { disabled: prefersReducedMotion || frameStarved })

  // 히어로가 화면을 벗어나면 장식 애니메이션을 멈춘다. CSS 애니메이션은 화면 밖으로
  // 나가도 스스로 멈추지 않아 배터리·GPU를 계속 먹는다.
  useOffscreenPause(sectionRef)

  useEffect(() => {
    getErrorTracker()
  }, [])

  const titleLine1 = t('titleLine1')
  const titleLine2 = t('titleLine2')

  // 제목 글자 수로 상한을 하나 더 건다. vw·vh만으로는 한국어 7자 기준에 맞춰진
  // 상한이 영문 25자에서 무력해져 제목이 네 줄로 접히고 히어로가 화면을 넘긴다.
  const longestLine = Math.max(titleLine1.length, titleLine2.length, 1)
  const titleFontSize = `clamp(2rem, min(9.5vw, 11vh, ${(145 / longestLine).toFixed(2)}vw), 8rem)`

  const rawDisciplines = t.raw('disciplines')
  // 로케일이 키를 빠뜨리면 use-intl은 throw 대신 키 문자열을 돌려준다. 가드가 없으면
  // .map에서 TypeError가 나고 SSR이 통째로 죽는다(클라이언트 에러 바운더리는 못 잡는다).
  const disciplines = Array.isArray(rawDisciplines) ? (rawDisciplines as string[]) : []

  return (
    <section
      ref={sectionRef}
      aria-labelledby="hero-title"
      data-lowfx={frameStarved || undefined}
      className={SECTION_CLASS}
      style={{ contain: 'layout style paint' }}
    >
      {/*
        장식 레이어 — 전부 transform/opacity만 사용.

        전체화면 레이어를 겹칠수록 비싸다. GPU 가속이 꺼진 환경에서는 합성이
        CPU로 내려오는데, 그때 비용은 (겹친 전체화면 레이어 수 × 화면 픽셀)에
        비례한다. 실측: QHD·소프트웨어 합성에서 레이어 6장 13fps, 3장 21fps.
        레이어 크기(inset)를 줄이는 건 화면 밖이 잘려 효과가 없었고, 장수를
        줄이는 것만 효과가 있었다. 그래서 같은 그림을 레이어 하나에 겹쳐 그린다.

        비네트는 움직이지 않으므로 컨테이너 배경으로 내려 레이어를 하나 더 없앤다.
      */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(125% 95% at 50% 38%, transparent 28%, rgba(0, 0, 0, 0.6) 100%)',
        }}
      >
        <div
          className="hero-wash"
          style={{
            background:
              'radial-gradient(42% 42% at 26% 24%, rgba(243, 133, 11, 0.17) 0%, rgba(243, 133, 11, 0) 70%), radial-gradient(46% 46% at 76% 74%, rgba(14, 165, 233, 0.18) 0%, rgba(14, 165, 233, 0) 72%)',
          }}
        />
        <div className="hero-spotlight" />
        <div className="hero-grain" />
      </div>

      {/* 타이포 블록 */}
      <div
        className="relative z-10 flex flex-col justify-center px-5 sm:px-8 lg:px-12"
        style={{
          // 낮은 노트북 창(720p 이하)에서도 하단 필름스트립이 접히지 않도록 수직
          // 리듬 전체를 화면 높이에 연동한다. 상단 여백은 고정 헤더(약 80px)를 비운다.
          paddingTop: 'clamp(3.25rem, 11vh, 7rem)',
          paddingBottom: 'clamp(0.75rem, 2.5vh, 2rem)',
        }}
      >
        <div className="mx-auto flex w-full max-w-[1400px] items-center gap-10">
          <div className="min-w-0 flex-1">
            <div className="hero-rise flex items-center gap-3 sm:gap-4">
              <span className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/70 sm:text-xs sm:tracking-[0.34em]">
                {t('kicker')}
              </span>
              <span className="h-px w-8 bg-white/35 sm:w-16" />
              <span className="text-[11px] uppercase tracking-[0.3em] text-white/60 sm:text-xs sm:tracking-[0.34em]">
                {t('est')}
              </span>
            </div>

            <h1
              id="hero-title"
              style={{
                fontWeight: 900,
                lineHeight: 0.94,
                letterSpacing: '-0.045em',
                fontSize: titleFontSize,
                marginTop: 'clamp(0.5rem, 2.5vh, 1.75rem)',
              }}
            >
              <span className="hero-rise block">{titleLine1}</span>
              {/* 아웃라인 줄 — 마스크 리빌. LCP 후보가 아니라 클리핑해도 안전하다. */}
              <span
                className="hero-mask"
                style={{ ['--motion-delay' as string]: '120ms' } as React.CSSProperties}
              >
                <span className="hero-outline-text">{titleLine2}</span>
              </span>
            </h1>

            <p
              className="hero-rise max-w-2xl text-[15px] leading-snug text-white/80 sm:text-lg sm:leading-relaxed"
              style={
                {
                  ['--motion-delay' as string]: '180ms',
                  marginTop: 'clamp(0.75rem, 3.5vh, 2rem)',
                } as React.CSSProperties
              }
            >
              {t('subtitle')}
              <br />
              <span className="text-white/65">{tc('brandShort')}</span>
            </p>

            <div
              className="hero-rise flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4"
              style={
                {
                  ['--motion-delay' as string]: '260ms',
                  marginTop: 'clamp(0.9rem, 4vh, 2.5rem)',
                } as React.CSSProperties
              }
            >
              <Link
                href="/about"
                // 흰 배경이 의도인 주 CTA — 포스터 테마 재매핑에서 제외한다
                data-poster-keep
                className="group inline-flex min-h-[48px] items-center justify-center gap-2 bg-white px-8 text-sm font-semibold tracking-tight text-black transition-colors duration-300 hover:bg-white/85 sm:min-h-[56px]"
              >
                {t('ctaAbout')}
                <span
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
              <Link
                href="/connect"
                className="inline-flex min-h-[48px] items-center justify-center border border-white/50 px-8 text-sm font-semibold tracking-tight text-white transition-colors duration-300 hover:border-white hover:bg-white/10 sm:min-h-[56px]"
              >
                {t('ctaJoin')}
              </Link>
              <span className="ml-auto hidden items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-white/60 sm:flex">
                {t('scrollLabel')}
                <span className="h-px w-8 bg-white/35" />
                <span aria-hidden="true">↓</span>
              </span>
            </div>
          </div>

          {/*
            포스터의 크레딧 블록. 절대 배치로 두면 영문처럼 제목이 길어질 때 글자
            위에 그대로 얹힌다. 흐름 안의 컬럼으로 두어 겹침이 구조적으로 불가능하게 한다.
          */}
          {disciplines.length > 0 && (
            <ul className="hero-rise hidden shrink-0 space-y-2.5 text-right text-[11px] uppercase tracking-[0.26em] text-white/60 lg:block">
              {disciplines.map(discipline => (
                <li key={discipline}>{discipline}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/*
        하단 밴드 — 이름 티커 + 사진 필름스트립. 살짝 기울여 포스터의 거친 결을 준다.
        기울기와 진입 애니메이션은 반드시 다른 요소에 걸어야 한다. 둘 다 transform을
        쓰는데 CSS 애니메이션이 일반 선언을 이기므로, 한 요소에 함께 두면 rotate가
        조용히 버려진다(기울기가 한 번도 렌더된 적 없던 원인).
      */}
      <div className="hero-band relative z-10 min-w-0">
        <div
          className="hero-rise"
          style={
            {
              ['--motion-delay' as string]: '340ms',
              paddingBottom: 'clamp(0.75rem, 2.5vh, 1.75rem)',
            } as React.CSSProperties
          }
        >
          <HeroFilmstrip artists={artists} />
        </div>
      </div>

      {PerformanceMonitor && (
        <PerformanceMonitor
          position="top-right"
          mode="compact"
          devOnly={true}
          showOnlyWhenLowPerf={false}
        />
      )}
    </section>
  )
}

export default memo(Hero)
