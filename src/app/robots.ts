import { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'
import { getSiteUrl } from '@/utils/site'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl()

  const privateRoutes = [
    '/admin',
    '/mypage',
    '/login',
    '/signup',
    '/notifications',
    '/register',
    '/board/write',
    '/board/*/edit',
    '/board-room',
  ]

  // 로케일 프리픽스가 `as-needed`라 기본 로케일(ko)만 접두사가 없다. 영문은
  // `/en/admin`처럼 접두사가 붙으므로, 위 목록만으로는 영문 경로가 그대로
  // 열려 있다(`/board-room`을 더하면서 확인했고, 기존 항목도 같은 상태였다).
  const localized = routing.locales
    .filter(locale => locale !== routing.defaultLocale)
    .flatMap(locale => privateRoutes.map(route => `/${locale}${route}`))
  const disallow = [...privateRoutes, ...localized]

  return {
    rules: [
      // 모든 크롤러: 공개 경로 허용, 비공개 경로 차단
      // 개별 봇 규칙을 쓰면 * 규칙이 무시되므로 단일 * 규칙으로 통합
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
    ],
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/image-sitemap.xml`],
    host: baseUrl,
  }
}
