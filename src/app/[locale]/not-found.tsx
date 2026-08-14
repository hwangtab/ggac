import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'

export const metadata: Metadata = {
  title: '페이지를 찾을 수 없습니다',
  description: '요청하신 페이지를 찾을 수 없습니다.',
  robots: { index: false, follow: false },
}

/**
 * 로케일 404 (/artists/없는사람 처럼 [locale] 안에서 못 찾은 경우).
 *
 * 루트 404(src/app/not-found.tsx)와 문구·생김새를 맞춘다. 이전에는 이쪽만
 * `bg-gradient-to-br from-primary-50 to-accent-50`에 파란 "404" 숫자를 쓰고
 * 있었는데, 다크 테마에서 그라디언트는 배경이 통째로 사라져 검은 화면에 파란
 * 숫자만 남았고 문구도 루트 404와 달랐다.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center text-white">
      <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">404 — NOT FOUND</p>
      <h1
        className="font-post font-black leading-[0.94] tracking-[-0.045em]"
        style={{ fontSize: 'clamp(2rem, 8vw, 5rem)' }}
      >
        여긴 아무것도 없습니다
      </h1>
      <p className="text-[15px] text-white/70">주소가 바뀌었거나 지워진 페이지입니다.</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          data-poster-keep
          className="inline-flex min-h-[48px] items-center justify-center bg-white px-8 text-sm font-semibold text-black transition-colors duration-200 hover:bg-white/85"
        >
          홈으로
        </Link>
        <Link
          href="/projects"
          className="inline-flex min-h-[48px] items-center justify-center border border-white/50 px-8 text-sm font-semibold transition-colors duration-200 hover:border-white hover:bg-white/10"
        >
          프로젝트 보기
        </Link>
      </div>
    </div>
  )
}
