'use client'

import { useEffect, useRef, memo } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import HeroFilmstrip from './HeroFilmstrip'
import PerformanceMonitor from './PerformanceMonitor'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { usePointerParallax } from '@/hooks/usePointerParallax'
import { getErrorTracker } from '@/utils/errorTracking'
import type { Artist } from '@/types/artist'

interface HeroProps {
  artists: Artist[]
}

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
 * 1. LCP인 h1 첫 줄은 opacity·clip 없이 transform만 움직인다. 첫 프레임부터
 *    완전히 보이므로 진입 애니메이션이 LCP를 밀지 않는다.
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

  // --mx/--my만 갱신한다. 이 값을 쓰는 건 스포트라이트 레이어 하나뿐.
  usePointerParallax(sectionRef, { disabled: prefersReducedMotion })

  useEffect(() => {
    getErrorTracker()
  }, [])

  return (
    <section
      ref={sectionRef}
      role="banner"
      aria-label={t('ariaMain')}
      className={SECTION_CLASS}
      style={{ contain: 'layout style paint' }}
    >
      {/* 장식 레이어 — 전부 transform/opacity만 사용 */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className="hero-wash"
          style={{
            background:
              'radial-gradient(42% 42% at 26% 24%, rgba(243, 133, 11, 0.17) 0%, rgba(243, 133, 11, 0) 70%)',
          }}
        />
        <div
          className="hero-wash"
          style={
            {
              background:
                'radial-gradient(46% 46% at 76% 74%, rgba(14, 165, 233, 0.18) 0%, rgba(14, 165, 233, 0) 72%)',
              ['--wash-duration' as string]: '46s',
              animationDirection: 'alternate-reverse',
            } as React.CSSProperties
          }
        />
        <div className="hero-spotlight" />
        <div className="hero-grain" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(125% 95% at 50% 38%, transparent 28%, rgba(0, 0, 0, 0.62) 100%)',
          }}
        />
      </div>

      {/* 타이포 블록 */}
      <div
        className="relative z-10 flex flex-col justify-center px-5 sm:px-8 lg:px-12"
        style={{
          // 낮은 노트북 창(720p 이하)에서도 하단 필름스트립이 접히지 않도록 수직
          // 리듬 전체를 화면 높이에 연동한다. 상단 여백은 고정 헤더(약 80px)를 비운다.
          paddingTop: 'clamp(4.5rem, 11vh, 7rem)',
          paddingBottom: 'clamp(1rem, 2.5vh, 2rem)',
        }}
      >
        <div className="relative mx-auto w-full max-w-[1400px]">
          {/*
            포스터의 크레딧 블록 — 왼쪽 정렬 제목이 남기는 오른쪽 여백을 채운다.
            제목이 가장 넓어지는 지점에서도 겹치지 않도록 lg 이상에서만 노출.
          */}
          <ul className="absolute right-0 top-1/2 hidden -translate-y-1/2 space-y-2.5 text-right text-[11px] uppercase tracking-[0.26em] text-white/30 lg:block">
            {(t.raw('disciplines') as string[]).map(discipline => (
              <li key={discipline}>{discipline}</li>
            ))}
          </ul>

          <div className="motion-fade-up flex items-center gap-3 sm:gap-4">
            <span className="text-[10px] font-medium uppercase tracking-[0.3em] text-white/50 sm:text-xs sm:tracking-[0.34em]">
              {t('kicker')}
            </span>
            <span className="h-px w-8 bg-white/25 sm:w-16" />
            <span className="text-[10px] uppercase tracking-[0.3em] text-white/35 sm:text-xs sm:tracking-[0.34em]">
              {t('est')}
            </span>
          </div>

          <h1
            style={{
              fontWeight: 900,
              lineHeight: 0.94,
              letterSpacing: '-0.045em',
              // vw만 쓰면 넓고 낮은 창에서 제목이 화면을 넘긴다. vh로 상한을 건다.
              fontSize: 'clamp(2.25rem, min(9.5vw, 11vh), 8rem)',
              marginTop: 'clamp(0.75rem, 2.5vh, 1.75rem)',
            }}
          >
            {/* LCP 줄 — 즉시 페인트되고 위치만 정착한다 */}
            <span className="hero-line-settle block">{t('titleLine1')}</span>
            {/* 아웃라인 줄 — 마스크 리빌. LCP 후보가 아니라 클리핑해도 안전하다. */}
            <span
              className="hero-mask"
              style={{ ['--motion-delay' as string]: '120ms' } as React.CSSProperties}
            >
              <span
                style={{
                  WebkitTextStroke: '0.013em rgba(255, 255, 255, 0.78)',
                  color: 'rgba(255, 255, 255, 0.07)',
                }}
              >
                {t('titleLine2')}
              </span>
            </span>
          </h1>

          <p
            className="motion-fade-up max-w-2xl text-[15px] leading-relaxed text-white/70 sm:text-lg"
            style={
              {
                ['--motion-delay' as string]: '380ms',
                marginTop: 'clamp(1rem, 3.5vh, 2rem)',
              } as React.CSSProperties
            }
          >
            {t('subtitle')}
            <br />
            <span className="text-white/45">{tc('brandShort')}</span>
          </p>

          <div
            className="motion-fade-up flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4"
            style={
              {
                ['--motion-delay' as string]: '480ms',
                marginTop: 'clamp(1.25rem, 4vh, 2.5rem)',
              } as React.CSSProperties
            }
          >
            <Link
              href="/about"
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
              className="inline-flex min-h-[48px] items-center justify-center border border-white/30 px-8 text-sm font-semibold tracking-tight text-white/90 transition-colors duration-300 hover:border-white/70 hover:bg-white/5 sm:min-h-[56px]"
            >
              {t('ctaJoin')}
            </Link>
            <span className="ml-auto hidden items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-white/35 sm:flex">
              {t('scrollLabel')}
              <span className="h-px w-8 bg-white/25" />
              <span aria-hidden="true">↓</span>
            </span>
          </div>
        </div>
      </div>

      {/* 하단 밴드 — 이름 티커 + 사진 필름스트립 */}
      <div
        className="motion-fade-up relative z-10 min-w-0"
        style={
          {
            ['--motion-delay' as string]: '300ms',
            paddingBottom: 'clamp(1rem, 2.5vh, 1.75rem)',
          } as React.CSSProperties
        }
      >
        <HeroFilmstrip artists={artists} />
      </div>

      <PerformanceMonitor
        position="top-right"
        mode="compact"
        devOnly={true}
        showOnlyWhenLowPerf={false}
      />
    </section>
  )
}

export default memo(Hero)
