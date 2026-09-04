import { MetadataRoute } from 'next'
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

  return {
    rules: [
      // 모든 크롤러: 공개 경로 허용, 비공개 경로 차단
      // 개별 봇 규칙을 쓰면 * 규칙이 무시되므로 단일 * 규칙으로 통합
      {
        userAgent: '*',
        allow: '/',
        disallow: privateRoutes,
      },
    ],
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/image-sitemap.xml`],
    host: baseUrl,
  }
}
